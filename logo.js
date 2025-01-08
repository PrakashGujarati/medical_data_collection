const mongoose = require("mongoose");
const puppeteer = require("puppeteer");

// Define the Clinic schema and model, including fields for scraped data
const ClinicSchema = new mongoose.Schema({
  doctorIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Doctor" }],
  clinicUrl: String,
  logo: Array,
  addressUrl: String,
  headline: String,
  clinicName: String,
  photos: Array,
  // other fields...
});
const Clinic = mongoose.model("Clinic", ClinicSchema);

// Define the Doctor schema and model
const DoctorSchema = new mongoose.Schema({
  uri: String,
  // other fields...
});
const Doctor = mongoose.model("Doctor", DoctorSchema);

// Retrieve doctor URIs for a given clinic ID
async function getDoctorUrisForClinic(clinicId) {
  try {
    await mongoose.connect(
      "mongodb+srv://medipractinfo:cFcK1u7cdJACr2Dk@medipract.vpxxvy1.mongodb.net/medipractweb",
      { tls: true }
    );

    const clinic = await Clinic.findById(clinicId).populate("doctorIds").exec();
    if (!clinic) {
      console.log("Clinic not found");
      return [];
    }

    return clinic.doctorIds.map((doctor) => doctor.uri);
  } catch (error) {
    console.error("Error connecting to MongoDB:", error);
    return [];
  } finally {
    await mongoose.disconnect();
  }
}

// Scrape clinic name and URL from a doctor's page
async function scrapeClinicDetails(url) {
  const browser = await puppeteer.launch({
    headless: true,
    ignoreHTTPSErrors: true,
  });
  const page = await browser.newPage();
  try {
    await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });

    const clinicDetails = await page.evaluate(() => {
      const clinicAnchor = document.querySelector(
        "h2 a.c-profile--clinic__name"
      );
      let clinicName = null;
      let clinicUrl = null;
      if (clinicAnchor) {
        clinicName = clinicAnchor.textContent.trim();
        clinicUrl = clinicAnchor.href.trim();
      }
      return { clinicName, clinicUrl };
    });

    return clinicDetails;
  } catch (error) {
    console.error(`Error navigating to ${url}:`, error);
    return {};
  } finally {
    await browser.close();
  }
}

// Scrape images, directions URL, specialty headline, and include clinicUrl in the result
async function scrapeImagesAndDirections(clinicUrl) {
  const browser = await puppeteer.launch({
    headless: true,
    ignoreHTTPSErrors: true,
  });
  const page = await browser.newPage();
  try {
    await page.goto(clinicUrl, { waitUntil: "networkidle2", timeout: 60000 });

    const result = await page.evaluate(() => {
      // Extract images
      const imageElements = Array.from(
        document.querySelectorAll('img[data-qa-id="clinic-image"]')
      );
      const logo = imageElements.map((element) => ({
        url: element.src.replace("/thumbnail", ""),
        thumbnail: element.src,
        alt: element.alt || "Hospital logo",
      }));

      // Extract the "Get Directions" URL
      const directionsAnchor = document.querySelector(
        'a[data-qa-id="get_directions"]'
      );
      let addressUrl = null;
      if (directionsAnchor) {
        addressUrl = directionsAnchor.href.trim();
      }

      // Extract clinic specialty headline
      const specialityElement = document.querySelector(
        'h2[data-qa-id="clinic-speciality"]'
      );
      let headline = null;
      if (specialityElement) {
        headline = specialityElement.textContent.trim();
      }

      return { logo, addressUrl, headline };
    });

    // Attach clinicUrl to the result object after evaluation
    result.clinicUrl = clinicUrl.replace("https://www.practo.com/", "");

    return result;
  } catch (error) {
    console.error(`Error scraping ${clinicUrl}:`, error);
    return {};
  } finally {
    await browser.close();
  }
}
async function scrapeClinicPhotos(url) {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
      timeout: 3000,
    });
    const page = await browser.newPage();
    await page.setDefaultNavigationTimeout(3000);
    await page.goto(url, { waitUntil: "domcontentloaded" });

    const firstImageSelector = 'img[data-qa-id="doctor-clinics-photo"]';
    await page.waitForSelector(firstImageSelector, { timeout: 3000 });
    await page.click(firstImageSelector);
    await delay(3000);

    const clinicPhotos = await page.evaluate(() => {
      return Array.from(
        document.querySelectorAll("img.c-carousel--item__large")
      ).map((img) => ({
        url: img.src,
        alt: img.alt || "N/A",
      }));
    });

    return { clinicPhotos };
  } catch (error) {
    logError(`Error in scrapeClinicPhotos (${url}): ${error.message}`);
    return null;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

// Update the clinic document in MongoDB with scraped data
async function updateClinic(clinicId, data, clinicUrl) {
  // <-- Accept clinicUrl as a parameter
  try {
    await mongoose.connect(
      "mongodb+srv://medipractinfo:cFcK1u7cdJACr2Dk@medipract.vpxxvy1.mongodb.net/medipractweb",
      { tls: true }
    );

    // --- Newly Added Snippet for Scraping Clinic Photos ---
    const clinicImages = await scrapeClinicPhotos(clinicUrl);
    const photos = clinicImages ? clinicImages.clinicPhotos : [];
    // If you have a clinicInstance or want to assign to data, adjust accordingly:
    data.photos = photos.length ? photos : data.photos || [];
    // ------------------------------------------------------
    console.log(data);
    //await Clinic.findByIdAndUpdate(clinicId, { $set: data }, { new: true });
  } catch (error) {
    //console.error("Error updating clinic in MongoDB:", error);
  } finally {
    await mongoose.disconnect();
  }
}

// Main execution flow
async function main() {
  const startIndex = 2; // Set your desired start index
  const endIndex = 10; // Set your desired end index (non-inclusive)
  try {
    await mongoose.connect(
      "mongodb+srv://medipractinfo:cFcK1u7cdJACr2Dk@medipract.vpxxvy1.mongodb.net/medipractweb",
      { tls: true }
    );

    // Fetch clinics within the specified range
    const clinics = await Clinic.find()
      .skip(startIndex)
      .limit(endIndex - startIndex)
      .exec();
    for (const clinic of clinics) {
      console.log(clinic._id);
      const clinicId = clinic._id; // Replace with actual Clinic ID
      const doctorUris = await getDoctorUrisForClinic(clinicId);
      const fullDoctorUrls = doctorUris.map((uri) =>
        uri.startsWith("http") ? uri : `https://www.practo.com/${uri}`
      );
      for (const url of fullDoctorUrls) {
        // Scrape basic clinic details from doctor's page
        const details = await scrapeClinicDetails(url);
        if (!details.clinicUrl) {
          console.error(`Could not find clinic details from ${url}`);
          continue;
        }
        // Use the clinic URL from details to scrape images, directions, etc.
        const clinicData = await scrapeImagesAndDirections(details.clinicUrl);

        // Update the clinic document in the database with the scraped data
        await updateClinic(clinicId, clinicData, details.clinicUrl);
      }
    }
  } catch (err) {
    console.error(`Error processing ${url}:`, err);
  }
}

main();

const puppeteer = require("puppeteer");
const cheerio = require("cheerio");
const fs = require("fs");
const mongoose = require("mongoose");

// Connect to MongoDB
mongoose
  .connect(
    "mongodb+srv://prakashgujaratiwork:1h8OT1TBS9710vcy@cluster0.5iu6l.mongodb.net/medipractweb_clinic"
  )
  .then(() => console.log("Connected to MongoDB"))
  .catch((err) => console.error("MongoDB connection error:", err));

const doctorSchema = new mongoose.Schema({
  name: { type: String },
  address: { type: String },
  uri: { type: String },
  // Removed city field
});

const Doctor = mongoose.model("Doctor", doctorSchema);

// Custom sleep function for delays
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const urls = [
  "https://www.healthfrog.in/doctor/list/punjab",
  "https://www.healthfrog.in/doctor/list/telangana",
  "https://www.healthfrog.in/doctor/list/uttar-pradesh",
  "https://www.healthfrog.in/doctor/list/gujarat",
  "https://www.healthfrog.in/doctor/list/maharashtra",
  "https://www.healthfrog.in/doctor/list/mizoram",
  "https://www.healthfrog.in/doctor/list/rajasthan",
  "https://www.healthfrog.in/doctor/list/kerala",
  "https://www.healthfrog.in/doctor/list/uttarakhand",
  "https://www.healthfrog.in/doctor/list/haryana",
  "https://www.healthfrog.in/doctor/list/andhra-pradesh",
  "https://www.healthfrog.in/doctor/list/jammu-and-kashmir",
  "https://www.healthfrog.in/doctor/list/tamil-nadu",
  "https://www.healthfrog.in/doctor/list/madhya-pradesh",
  "https://www.healthfrog.in/doctor/list/bihar",
  "https://www.healthfrog.in/doctor/list/karnataka",
  "https://www.healthfrog.in/doctor/list/himachal-pradesh",
  "https://www.healthfrog.in/doctor/list/assam",
  "https://www.healthfrog.in/doctor/list/west-bengal",
  "https://www.healthfrog.in/doctor/list/chhattisgarh",
  "https://www.healthfrog.in/doctor/list/manipur",
  "https://www.healthfrog.in/doctor/list/jharkhand",
  "https://www.healthfrog.in/doctor/list/chandigarh",
  "https://www.healthfrog.in/doctor/list/delhi",
  "https://www.healthfrog.in/doctor/list/pondicherry",
  "https://www.healthfrog.in/doctor/list/goa",
];

async function scrapePage(page, url, fileName) {
  console.log(`Navigating to ${url}`);
  await page.goto(url, { waitUntil: "networkidle2" });

  console.log("Waiting for initial content to load...");
  await sleep(3000);

  const isLoadMoreVisible = async () => {
    return await page.evaluate(() => {
      const button = document.querySelector("#loadmore");
      if (!button) return false;
      const style = window.getComputedStyle(button);
      return (
        style &&
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        style.opacity !== "0"
      );
    });
  };

  let loadMoreCount = 0;
  let accumulatedData = [];

  if (fs.existsSync(fileName)) {
    try {
      const existingData = JSON.parse(fs.readFileSync(fileName, "utf-8"));
      if (Array.isArray(existingData)) {
        accumulatedData = existingData;
      }
    } catch (e) {
      console.error(`Error reading existing file ${fileName}: ${e}`);
    }
  }

  while (await isLoadMoreVisible()) {
    loadMoreCount += 1;
    console.log(`Clicking "Load More Records" Attempt #${loadMoreCount}`);

    try {
      await page.evaluate(() => {
        const button = document.querySelector("#loadmore");
        if (button) {
          button.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      });
      await sleep(1000);

      const buttonClicked = await page.evaluate(() => {
        const button = document.querySelector("#loadmore");
        if (button) {
          button.click();
          return true;
        }
        return false;
      });

      if (!buttonClicked) {
        console.log("Load More button not found.");
        break;
      }

      console.log('Clicked "Load More Records".');
      await sleep(2000);

      const pageContent = await page.content();
      const $ = cheerio.load(pageContent);
      const listings = $("div.listing");

      const initialDataCount = accumulatedData.length;
      // Extract and store new doctor data
      // for (let i = 0; i < listings.length; i++) {
      //   const listing = listings.eq(i);
      //   const titleTag = listing.find("h3 a");
      //   const name = titleTag.text().trim() || null;
      //   const uri = titleTag.attr("href") || null;
      //   const address = listing.find("p").text().trim() || null;

      //   if (!accumulatedData.find((item) => item.uri === uri)) {
      //     const doctorData = { name, address, uri };
      //     accumulatedData.push(doctorData);

      //     try {
      //       const existingDoctor = await Doctor.findOne({ uri });
      //       if (!existingDoctor) {
      //         await Doctor.create(doctorData);
      //         console.log(`Saved doctor to DB: ${name}`);
      //       } else {
      //         console.log(`Doctor already in DB: ${name}`);
      //       }
      //     } catch (dbError) {
      //       console.error("Error saving to DB:", dbError);
      //     }
      //   }
      // }

      // Inside the scrapePage function, within the while loop after fetching listings...
      for (let i = 0; i < listings.length; i++) {
        const listing = listings.eq(i);
        const titleTag = listing.find("h3 a");
        const name = titleTag.text().trim() || null;
        const uri = titleTag.attr("href") || null;
        const address = listing.find("p").text().trim() || null;

        // Skip processing if doctor already exists in the database
        try {
          const existingDoctor = await Doctor.findOne({ uri });
          if (existingDoctor) {
            console.log(`Doctor already in DB: ${name}. Skipping...`);
            continue; // Move to the next iteration if doctor exists
          }
        } catch (dbError) {
          console.error("Error checking DB for existing doctor:", dbError);
          continue; // Skip current iteration on error
        }

        // Also ensure it's not a duplicate in our accumulated data
        if (!accumulatedData.find((item) => item.uri === uri)) {
          const doctorData = { name, address, uri };
          accumulatedData.push(doctorData);

          try {
            await Doctor.create(doctorData);
            console.log(`Saved doctor to DB: ${name}`);
          } catch (dbError) {
            console.error("Error saving to DB:", dbError);
          }
        }
      }

      // If no new records were added, break out of the loop
      if (accumulatedData.length === initialDataCount) {
        console.log("No new data found in this iteration. Breaking loop.");
        break;
      }

      // Write updated accumulated data to file after each iteration
      fs.writeFileSync(
        fileName,
        JSON.stringify(accumulatedData, null, 4),
        "utf-8"
      );
      console.log(
        `Data appended after attempt #${loadMoreCount}. Total records: ${accumulatedData.length}`
      );
    } catch (error) {
      console.error("Error during load more:", error);
      break;
    }
  }

  console.log(
    `Finished loading more records after ${loadMoreCount} attempts for URL: ${url}.`
  );
}

(async () => {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  // Retrieve URL index or specific URL from command-line arguments
  const arg = process.argv[2];
  let selectedUrls = [];

  if (arg) {
    const index = parseInt(arg, 10);
    // If a valid index is provided and within bounds, select that URL
    if (!isNaN(index) && index >= 0 && index < urls.length) {
      selectedUrls.push(urls[index]);
    } else {
      console.error(
        "Invalid index provided. Please provide a valid URL index between 0 and",
        urls.length - 1
      );
      await browser.close();
      mongoose.connection.close();
      process.exit(1);
    }
  } else {
    // If no argument given, process all URLs
    selectedUrls = urls;
  }

  for (const url of selectedUrls) {
    try {
      // Determine filename from the last segment of URL
      const parts = url.split("/").filter(Boolean);
      const lastSegment = parts[parts.length - 1] || "index";
      const fileName = `${lastSegment}.json`;

      console.log(`Starting scrape for ${url}, saving to ${fileName}`);
      await scrapePage(page, url, fileName);
      console.log(`Completed scrape for ${url}`);
    } catch (error) {
      console.error(`Error scraping ${url}:`, error);
    }
  }

  await browser.close();
  console.log("All URLs processed.");
  mongoose.connection.close();
})();

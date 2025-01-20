const puppeteer = require("puppeteer");
const axios = require("axios");
const mongoose = require("mongoose");

// Replace with your actual connection string
const MONGODB_URI =
  "mongodb+srv://prakashgujaratiwork:1h8OT1TBS9710vcy@cluster0.5iu6l.mongodb.net/medipractweb_clinic";
const GOOGLE_API_KEY = "AIzaSyD1QD2NpGM--cu3r2Hp-3VKIlVBrAGoX7o"; // Replace with your API key

// Define a Mongoose schema and model for doctors, including specialty field
const doctorSchema = new mongoose.Schema({
  name: String,
  address: String,
  uri: String,
  city: String,
  mobile: String,
  phone: String,
  specialty: String, // Added specialty field
  // Add other fields as necessary
});

const Doctor = mongoose.model("Doctor", doctorSchema);

// Utility function to clean up the address string
function cleanAddress(address) {
  return address
    .replace(/\s+,/g, ",") // Remove spaces before commas
    .replace(/,+/g, ",") // Replace multiple commas with a single comma
    .replace(/^,|,$/g, "") // Trim leading/trailing commas
    .trim();
}

async function cityFromPincode(pincode) {
  try {
    const response = await axios.get(
      `https://api.postalpincode.in/pincode/${pincode}`
    );
    const data = response.data;
    if (data && data.length > 0 && data[0].Status === "Success") {
      const postOffices = data[0].PostOffice;
      if (postOffices && postOffices.length > 0) {
        return postOffices[0].District;
      }
    }
  } catch (error) {
    console.error("Error fetching city from pincode:", error);
  }
  return null;
}

async function addressToCity(address) {
  try {
    const cleanedAddress = cleanAddress(address);

    let response = await axios.get(
      "https://maps.googleapis.com/maps/api/geocode/json",
      {
        params: {
          address: cleanedAddress,
          key: GOOGLE_API_KEY,
        },
      }
    );

    let results = response.data.results;
    if (results && results.length > 0) {
      const components = results[0].address_components;
      for (const comp of components) {
        if (comp.types.includes("locality")) {
          return comp.long_name;
        }
      }
    }

    const pinMatch = cleanedAddress.match(/\b\d{6}\b/);
    if (pinMatch) {
      const pincode = pinMatch[0];
      const city = await cityFromPincode(pincode);
      if (city) {
        return city;
      }
    }
  } catch (error) {
    console.error("Error in addressToCity:", error);
  }
  return null;
}

async function scrapeDoctorProfile(doctor) {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  try {
    // Attempt to navigate to the doctor's URI with a timeout
    await page.goto(doctor.uri, { waitUntil: "networkidle2", timeout: 30000 });
  } catch (navError) {
    console.error(`Navigation timed out for ${doctor.uri}:`, navError);
    await browser.close();
    return {}; // Return an empty object on navigation timeout
  }

  const doctorData = await page.evaluate(() => {
    const result = {};

    // Extract address text content
    const addressEl =
      document.querySelector("p i.fa-map-marker")?.parentElement;
    result.address = addressEl ? addressEl.textContent.trim() : "";

    // Extract mobile number
    const mobileEl = document.querySelector("p i.fa-mobile")?.parentElement;
    if (mobileEl) {
      const mobileText = mobileEl.textContent
        .replace(/\s+/g, " ")
        .replace(/Edit.*$/, "")
        .replace("(+91)", "+91")
        .trim();
      const mobileMatch = mobileText.match(/(\+?\d[\d\-\(\)\s]+)/);
      result.mobile = mobileMatch ? mobileMatch[0].trim() : null;
    }

    // Extract phone number
    const phoneEl = document.querySelector("p i.fa-phone")?.parentElement;
    if (phoneEl) {
      const phoneText = phoneEl.textContent
        .replace(/\s+/g, " ")
        .replace(/Edit.*$/, "")
        .trim();
      const phoneMatch = phoneText.match(/(\+?\d[\d\-\(\)\s]+)/);
      result.phone = phoneMatch ? phoneMatch[0].trim() : null;
    }

    // Extract specialty from tags
    const specialtyAnchor = document.querySelector(
      ".tags span.label-default a"
    );
    result.specialty = specialtyAnchor
      ? specialtyAnchor.textContent.trim()
      : null;

    return result;
  });

  // Attempt to derive city from address if available
  if (doctor.address) {
    doctorData.city = await addressToCity(doctor.address);
  } else {
    doctorData.city = null;
  }

  await browser.close();
  return doctorData;
}

async function cleanAndProcessDoctors(startIndex, endIndex) {
  try {
    await mongoose.connect(MONGODB_URI);

    // Query doctors in the given range
    const doctors = await Doctor.find({
      $or: [{ specialty: { $exists: false } }, { specialty: "" }],
    })

    for (const doctor of doctors) {
      const originalAddress = doctor.address || "";
      const cleanedAddr = cleanAddress(originalAddress);

      // Update the address if necessary
      if (cleanedAddr && cleanedAddr !== originalAddress) {
        doctor.address = cleanedAddr;
        await doctor.save();
      }

      // Scrape profile data and update doctor document
      if (doctor.uri) {
        const scrapedData = await scrapeDoctorProfile(doctor);
        console.log("Scraped Data:", scrapedData);
        if (scrapedData) {
          // Update fields if scraped data is available
          if (scrapedData.city) doctor.city = scrapedData.city;
          if (scrapedData.mobile) doctor.mobile = scrapedData.mobile;
          if (scrapedData.phone) doctor.phone = scrapedData.phone;
          if (scrapedData.specialty) doctor.specialty = scrapedData.specialty;

          await doctor.save();
          console.log(`Updated info for doctor ${doctor._id}`);
        }
      }
    }
  } catch (error) {
    console.error("Error processing doctors:", error);
  } finally {
    await mongoose.disconnect();
  }
}

// Parse command-line arguments for startIndex and endIndex
const [startArg, endArg] = process.argv.slice(2);
const startIndex = parseInt(startArg, 10) || 0;
const endIndex = parseInt(endArg, 10) || startIndex;

cleanAndProcessDoctors(startIndex, endIndex).catch(console.error);

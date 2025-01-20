/**
 * Usage:
 *   node scrape-doctor.js <doctorProfileURL>
 */

const puppeteer = require("puppeteer");
const axios = require("axios");

// Replace with your actual API key
const GOOGLE_API_KEY = "YOUR_GOOGLE_API_KEY_HERE";

// Utility function to clean up the address string
function cleanAddress(address) {
  return address
    .replace(/\s+,/g, ",") // Remove spaces before commas
    .replace(/,+/g, ",") // Replace multiple commas with a single comma
    .replace(/^,|,$/g, "") // Trim leading/trailing commas
    .trim();
}

// Fetch city name from Indian PIN code (uses the api.postalpincode.in service)
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

// Use the Google Geocoding API to get the city name from an address
async function addressToCity(address) {
  try {
    const cleanedAddress = cleanAddress(address);

    // Attempt using Google Geocoding
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
        // 'locality' is usually the city
        if (comp.types.includes("locality")) {
          return comp.long_name;
        }
      }
    }

    // If Geocoding didn't yield a city, try extracting PIN code
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

// Main function to scrape the doctor profile from a given URL
async function scrapeDoctorProfile(url) {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  // Navigate to the URL
  await page.goto(url, { waitUntil: "networkidle2" });

  // Extract information from the page
  const doctorData = await page.evaluate(() => {
    const result = {};

    // Extract address
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

  // Clean the address
  if (doctorData.address) {
    const cleanedAddr = cleanAddress(doctorData.address);
    doctorData.address = cleanedAddr;

    // Attempt to get the city from the address
    doctorData.city = await addressToCity(cleanedAddr);
  } else {
    doctorData.city = null;
  }

  await browser.close();
  return doctorData;
}

// --- MAIN EXECUTION ---

(async () => {
  const url = process.argv[2];
  if (!url) {
    console.error("Usage: node scrape-doctor.js <doctorProfileURL>");
    process.exit(1);
  }

  try {
    const data = await scrapeDoctorProfile(url);
    console.log("Scraped Doctor Data:\n", data);
  } catch (error) {
    console.error("Error scraping URL:", error);
  }
})();

const axios = require("axios");
const cheerio = require("cheerio");
const mongoose = require("mongoose");
const BASE_URL = "https://www.drdata.in";

// Get page range from command-line arguments
const args = process.argv.slice(2);
const startPage = parseInt(args[0], 10) || 1;
const endPage = parseInt(args[1], 10) || 100;

// Connect to MongoDB
const MONGO_URI =
  "mongodb+srv://iwellnessai:SwxrM8w5eSGppWKS@cluster0.gh31p.mongodb.net/medipractweb_hospital"; // Update with your actual connection string
mongoose.connect(MONGO_URI);
mongoose.connection.on("connected", () => {
  console.log("Mongoose connected to", MONGO_URI);
});
mongoose.connection.on("error", (err) => {
  console.error("Mongoose connection error:", err);
});
const doctorSchema = new mongoose.Schema({
  name: String,
  specialization: String,
  degree: String,
  state: String,
  city: String,
  profile_url: String,
  area_of_practice: String,
  practicing_since: String,
  medical_council: String,
  registration_number: String,
  clinic_hospital: String,
  date_of_birth: String,
  address: String,
  phone_number: String,
  graduation_course: String,
  post_graduation_course: String,
  about_doctor: String,
});

const Doctor = mongoose.model("Doctor", doctorSchema);

async function fetchDoctorProfile(profileUrl) {
  if (!profileUrl) return {}; // Return empty if no profile URL

  try {
    const { data } = await axios.get(profileUrl, { maxRedirects: 5 });
    const $ = cheerio.load(data);

    return {
      area_of_practice: $('td[data-title="Area of Practice"]')
        .next()
        .text()
        .trim(),
      practicing_since: $('td[data-title="Practicing Since"]')
        .next()
        .text()
        .trim(),
      medical_council: $('td[data-title="Name of Medical Council"]')
        .next()
        .text()
        .trim(),
      registration_number: $('td[data-title="Registration Number"]')
        .next()
        .text()
        .trim(),
      clinic_hospital: $('td[data-title="Clinic/ Hospital Name"]')
        .next()
        .text()
        .trim(),
      date_of_birth: $('td[data-title="Date of Birth"]').next().text().trim(),
      address: $('td[data-title="Address"]').next().text().trim(),
      phone_number: $('td[data-title="Phone Number"]').next().text().trim(),
      graduation_course: $('td[data-title="Graduation Course"]')
        .next()
        .text()
        .trim(),
      post_graduation_course: $('td[data-title="Post Graduation Course"]')
        .next()
        .text()
        .trim(),
      about_doctor: $('td[data-title="Remark"]').next().text().trim(),
    };
  } catch (error) {
    if (error.response && error.response.status === 404) {
      console.warn(`Profile not found: ${profileUrl}`);
    } else if (error.code === "ERR_FR_TOO_MANY_REDIRECTS") {
      console.warn(`Too many redirects: ${profileUrl}`);
    } else {
      console.error(`Error fetching profile: ${profileUrl}`, error);
    }
    return null; // Return null for invalid profiles
  }
}

async function scrapeDoctors() {
  try {
    for (let page = startPage; page <= endPage; page++) {
      console.log(`Scraping page ${page}...`);
      const { data } = await axios.get(
        `${BASE_URL}/list-doctors.php?search=Doctor&page=${page}`
      );
      const $ = cheerio.load(data);
      const doctorRows = $("section#no-more-tables tbody tr");

      for (const element of doctorRows) {
        const name = $(element).find('td[data-title="Name"]').text().trim();
        const specialization = $(element)
          .find('td[data-title="Special."]')
          .text()
          .trim();
        const degree = $(element).find('td[data-title="Degree"]').text().trim();
        const state = $(element).find('td[data-title="State"]').text().trim();
        const city = $(element).find('td[data-title="City"]').text().trim();
        const profilePath = $(element)
          .find('td[data-title="Details"] a')
          .attr("href");
        const profileUrl = profilePath ? `${BASE_URL}/${profilePath}` : null;

        let profileDetails = {};
        if (profileUrl) {
          profileDetails = await fetchDoctorProfile(profileUrl);
          if (!profileDetails) continue; // Skip invalid profiles
        }

        // Create a new Doctor document
        const doctorData = {
          name,
          specialization,
          degree,
          state,
          city,
          profile_url: profileUrl,
          ...profileDetails, // Merge profile details
        };

        try {
          const doctor = new Doctor(doctorData);
          await doctor.save();
          console.log(`Saved: ${name}`);
        } catch (saveError) {
          console.error(`Error saving doctor ${name}:`, saveError);
        }
      }
    }
  } catch (error) {
    console.error("Error scraping data:", error);
  } finally {
    mongoose.connection.close(() => {
      console.log("Mongoose connection closed.");
    });
  }
}

scrapeDoctors();

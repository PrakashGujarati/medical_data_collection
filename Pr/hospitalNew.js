const puppeteer = require("puppeteer");
const fs = require("fs");
const mongoose = require("mongoose");
const xml2js = require("xml2js");

/************************************************************
 * Utility Logging Function
 ************************************************************/
function logError(message, url = "") {
  const timestamp = new Date().toISOString();
  const urlInfo = url ? ` [URL: ${url}]` : "";
  fs.appendFileSync("error.log", `[${timestamp}]${urlInfo} ${message}\n`);
}

/************************************************************
 * 1. Mongoose Connection Setup
 ************************************************************/
const MONGODB_URI =
  "mongodb+srv://medipractinfo:cFcK1u7cdJACr2Dk@medipract.vpxxvy1.mongodb.net/medipractweb"; // Replace with your actual MongoDB URI

mongoose
  .connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log("Connected to MongoDB"))
  .catch((err) => {
    console.error("MongoDB connection error:", err);
    logError(`MongoDB connection error: ${err.message}`);
    process.exit(1); // Exit the script if unable to connect to MongoDB
  });

/************************************************************
 * 2. Define Mongoose Schema and Model for Hospital
 ************************************************************/
const hospitalSchema = new mongoose.Schema({
  name: String,
  address: String,
  area: String,
  headline: String,
  doctor_count: String,
  image: {
    url: String,
    thumbnail: String,
    alt: String,
  },
  about: String,
  addressUrl: String,
  timings_day: String,
  timing_session: String,
  payment_modes: String,
  doctorIds: Array, // Array of doctor IDs or details
  photos: Array,
  services: Array,
});
const Hospital = mongoose.model("Hospital", hospitalSchema);

/************************************************************
 * 3. Scraping Functions
 ************************************************************/

/**
 * Scrape Hospital Overview
 * @param {puppeteer.Page} page
 * @returns {Object} Hospital Overview Data
 */
async function scrapeHospitalOverview(page) {
  try {
    return await page.evaluate(() => {
      const getText = (selector) => {
        const element = document.querySelector(selector);
        return element ? element.innerText.trim() : null;
      };

      const getHref = (selector) => {
        const element = document.querySelector(selector);
        return element ? element.href : null;
      };

      const getImageData = (selector) => {
        const element = document.querySelector(selector);
        return element
          ? {
              url: element.src.replace("/thumbnail", ""),
              thumbnail: element.src,
              alt: element.alt || "Hospital logo",
            }
          : null;
      };

      return {
        name: getText('span[data-qa-id="hospital_name"]'),
        address: getText('p[data-qa-id="address_body"]'),
        area: getText('h2[data-qa-id="hospital-locality"]'),
        headline: getText('h2[data-qa-id="hospital_speciality"]'),
        doctor_count: getText('h2[data-qa-id="doctor_count"]'),
        image: getImageData('img[data-qa-id="logo"]'),
        about: getText("p.c-profile__description"),
        addressUrl: getHref('a[data-qa-id="get_directions"]'),
        timings_day: getText('p[data-qa-id="clinic-timings-day"]'),
        timing_session: getText('p[data-qa-id="clinic-timings-session"]'),
        payment_modes: getText('p[data-qa-id="payment_modes_body"]'),
      };
    });
  } catch (error) {
    console.error("Error in scrapeHospitalOverview:", error);
    logError(`scrapeHospitalOverview Error: ${error.message}`);
    return {};
  }
}

/**
 * Scrape Doctors Information
 * @param {puppeteer.Page} page
 * @returns {Array} List of Doctors
 */
async function scrapeDoctors(page) {
  const doctors = [];

  try {
    const doctorsTabSelector = 'a[href*="doctors"]';
    await page.waitForSelector(doctorsTabSelector, {
      visible: true,
      timeout: 10000,
    });

    const doctorsTab = await page.$(doctorsTabSelector);
    if (doctorsTab) {
      await Promise.all([
        doctorsTab.click(),
        page.waitForNavigation({
          waitUntil: "domcontentloaded",
          timeout: 10000,
        }),
      ]);

      // Wait for the doctor list to load
      await page.waitForSelector('div[data-qa-id="doctor_card_default"]', {
        timeout: 10000,
      });

      // Load all doctors by clicking the "More" button repeatedly
      while (true) {
        try {
          const loadMoreButton = await page.$(
            'button[data-qa-id="view-more-doctors"]'
          );
          if (!loadMoreButton) break;

          await Promise.all([
            page.waitForNavigation({
              waitUntil: "domcontentloaded",
              timeout: 10000,
            }),
            loadMoreButton.click(),
          ]);
        } catch (err) {
          console.warn(
            "No more 'View More Doctors' buttons found or timeout:",
            err
          );
          break;
        }
      }

      // Scrape all doctors' details
      const scrapedDoctors = await page.evaluate(() => {
        const doctorElements = document.querySelectorAll(
          'div[data-qa-id="doctor_card_default"]'
        );
        return Array.from(doctorElements).map((doctor) => ({
          name: doctor
            .querySelector('h2[data-qa-id="doctor_name"]')
            ?.innerText.trim(),
          specialization: doctor
            .querySelector('h3[data-qa-id="doctor_specialisation"]')
            ?.innerText.trim(),
          experience: doctor
            .querySelector('h3[data-qa-id="doctor_experience"]')
            ?.innerText.trim(),
          fee: doctor
            .querySelector('span[data-qa-id="consultation_fee"]')
            ?.innerText.trim(),
          timings: doctor
            .querySelector('span[data-qa-id="doctor_visit_timings"]')
            ?.innerText.trim(),
        }));
      });

      doctors.push(...scrapedDoctors);
    }
  } catch (error) {
    console.error("Error in scrapeDoctors:", error);
    logError(`scrapeDoctors Error: ${error.message}`);
  }

  return doctors;
}

/**
 * Scrape Stories (Feedback)
 * @param {puppeteer.Page} page
 * @returns {Array} List of Stories
 */
async function scrapeStories(page) {
  const stories = [];

  try {
    // Locate the "Stories" button by matching its text content
    const storiesTab = await page.evaluateHandle(() => {
      const buttons = Array.from(
        document.querySelectorAll("button.c-btn--unstyled")
      );
      return buttons.find((button) => button.innerText.includes("Stories"));
    });

    if (storiesTab) {
      // Click on the "Stories" tab
      await Promise.all([
        page.waitForNavigation({
          waitUntil: "domcontentloaded",
          timeout: 10000,
        }),
        storiesTab.asElement().click(),
      ]);

      // Wait for feedback items to load
      await page.waitForSelector('div[data-qa-id="feedback_item"]', {
        timeout: 10000,
      });

      // Scrape all stories data
      const scrapedStories = await page.evaluate(() => {
        const feedbackElements = document.querySelectorAll(
          'div[data-qa-id="feedback_item"]'
        );

        return Array.from(feedbackElements).map((feedback) => {
          const getText = (element, selector) =>
            element.querySelector(selector)?.innerText.trim() || null;

          return {
            name: getText(feedback, 'span[data-qa-id="reviewer-name"]'),
            time: getText(feedback, 'span[data-qa-id="web-review-time"]'),
            visitedFor: getText(feedback, 'p[data-qa-id="visited-for"]'),
            recommendation: getText(
              feedback,
              'div[data-qa-id="feedback_thumbs_up"] + span'
            ),
            review: getText(feedback, 'p[data-qa-id="review-text"]'),
            happyWith: Array.from(
              feedback.querySelectorAll("span.feedback__context")
            ).map((context) => context.innerText.trim()),
          };
        });
      });

      stories.push(...scrapedStories);
    }
  } catch (error) {
    console.error("Error in scrapeStories:", error);
    logError(`scrapeStories Error: ${error.message}`);
  }

  return stories;
}

/**
 * Scrape Services Offered
 * @param {puppeteer.Page} page
 * @returns {Array} List of Services
 */
async function scrapeServices(page) {
  const services = [];

  try {
    // Short delay to ensure the page is ready
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Locate and click the "Services" button
    const servicesTab = await page.evaluateHandle(() => {
      const buttons = Array.from(
        document.querySelectorAll("button.c-btn--unstyled")
      );
      return buttons.find((button) => button.innerText.includes("Services"));
    });

    if (servicesTab) {
      await Promise.all([
        page.waitForNavigation({
          waitUntil: "domcontentloaded",
          timeout: 10000,
        }),
        servicesTab.asElement().click(),
      ]);

      // Locate and click the "View All" button if it exists
      const viewAllButton = await page.evaluateHandle(() => {
        const buttons = Array.from(
          document.querySelectorAll("button.view-more")
        );
        return buttons.find((button) => button.innerText.includes("View all"));
      });

      if (viewAllButton) {
        await Promise.all([
          page.waitForSelector('div[data-qa-id="services-item"]', {
            timeout: 10000,
          }),
          viewAllButton.asElement().click(),
        ]);

        // Scrape all service titles
        const scrapedServices = await page.evaluate(() => {
          const serviceElements = document.querySelectorAll(
            'div[data-qa-id="services-item"]'
          );
          return Array.from(serviceElements)
            .map(
              (service) =>
                service
                  .querySelector(
                    "span.p-entity__item-title-label a, span.p-entity__item-title-label span"
                  )
                  ?.innerText.trim() || null
            )
            .filter(Boolean);
        });

        services.push(...scrapedServices);
      } else {
        console.warn("View All button not found in Services section.");
      }
    } else {
      console.warn("Services tab not found.");
    }
  } catch (error) {
    console.error("Error in scrapeServices:", error);
    logError(`scrapeServices Error: ${error.message}`);
  }

  return services;
}

/**
 * Scrape Hospital Photos
 * @param {puppeteer.Page} page
 * @returns {Array} List of Photos
 */
async function scrapeHospitalPhotos(page) {
  const photos = [];

  try {
    // Selector for the photo button or image
    const photoButtonSelector = 'img[data-qa-id="doctor-clinics-photo"]';

    // Ensure photos container is loaded
    await page.waitForSelector(photoButtonSelector, { timeout: 10000 });

    // Click on the photo to open the gallery if applicable
    const photoButton = await page.$(photoButtonSelector);
    if (photoButton) {
      await Promise.all([
        page.waitForNavigation({
          waitUntil: "domcontentloaded",
          timeout: 10000,
        }),
        photoButton.click(),
      ]);
    }

    // Extract clinic photos
    const scrapedPhotos = await page.evaluate(() => {
      return Array.from(
        document.querySelectorAll("img.c-carousel--item__large")
      ).map((img) => ({
        url: img.src,
        alt: img.alt || "N/A",
      }));
    });

    photos.push(...scrapedPhotos);
  } catch (error) {
    console.error("Error in scrapeHospitalPhotos:", error);
    logError(`scrapeHospitalPhotos Error: ${error.message}`);
  }

  return photos;
}

/**
 * Scrape Details for a Single Hospital
 * @param {string} url Hospital URL
 * @returns {Object|null} Scraped Hospital Details or null if failed
 */
async function scrapeHospitalDetails(url) {
  let browser;
  let hospitalDetails = null;

  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
      timeout: 60000,
    });
    const page = await browser.newPage();

    // Set a reasonable navigation timeout
    await page.setDefaultNavigationTimeout(60000);

    // Navigate to the hospital URL
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });

    // Scrape hospital overview
    const overview = await scrapeHospitalOverview(page);

    // Scrape doctors
    const doctors = await scrapeDoctors(page);

    // Scrape stories
    const stories = await scrapeStories(page);

    // Scrape services
    const services = await scrapeServices(page);

    // Scrape photos
    const photos = await scrapeHospitalPhotos(page);

    // Build the final hospital details object
    hospitalDetails = {
      ...overview,
      doctorIds: doctors, // Depending on your schema, you might want to process doctor data differently
      stories, // If you want to store stories
      photos,
      services,
    };

    // Save to MongoDB
    const hospitalDoc = new Hospital(hospitalDetails);
    await hospitalDoc.save();
    console.log(`Hospital details saved for URL: ${url}`);
  } catch (error) {
    console.error(`Error scraping URL ${url}:`, error);
    logError(`scrapeHospitalDetails Error: ${error.message}`, url);
  } finally {
    if (browser) {
      await browser.close();
    }
  }

  return hospitalDetails;
}

/************************************************************
 * 4. Process XML File and Loop Over URLs
 ************************************************************/

/**
 * Process Clinic URLs from an XML File
 * @param {string} xmlFilePath Path to the XML file
 */
async function processHospitalUrlsFromXml(xmlFilePath) {
  // Read XML file
  let xmlData;
  try {
    xmlData = fs.readFileSync(xmlFilePath, "utf8");
  } catch (readError) {
    console.error("Error reading XML file:", readError);
    logError(`XML Read Error: ${readError.message}`);
    return;
  }

  // Parse XML to JavaScript Object
  let parsedXml;
  try {
    const parser = new xml2js.Parser({ strict: false, normalizeTags: true });
    parsedXml = await parser.parseStringPromise(xmlData);
  } catch (error) {
    console.error("Failed to parse XML:", error);
    logError(`XML Parse Error: ${error.message}`);
    return;
  }

  // Extract hospital URLs from the XML
  const hospitalUrls = new Set();
  const urlEntries = (parsedXml.urlset && parsedXml.urlset.url) || [];
  for (const entry of urlEntries) {
    if (entry.loc && Array.isArray(entry.loc) && entry.loc[0]) {
      const url = entry.loc[0];
      // Adjust the regex to match hospital URLs; modify if necessary
      const match = url.match(
        /^https:\/\/www\.practo\.com\/[^\/]+\/hospital\/[^\/]+/
      );
      if (match) {
        hospitalUrls.add(url);
      }
    }
  }

  console.log(`Found ${hospitalUrls.size} hospital URLs to process.`);

  // Loop over each hospital URL and scrape details
  for (const url of hospitalUrls) {
    console.log(`Processing Hospital URL: ${url}`);
    try {
      await scrapeHospitalDetails(url);
    } catch (error) {
      console.error(`Error processing ${url}:`, error);
      logError(`Processing Error: ${error.message}`, url);
    }
  }

  console.log("All hospital URLs have been processed.");
}

/************************************************************
 * 5. Entry Point
 ************************************************************/
const xmlFilePath = process.argv[2];
if (!xmlFilePath) {
  console.error("Please provide the XML file path as a command-line argument.");
  console.error("Usage: node scrapeHospitals.js path/to/your_file.xml");
  process.exit(1);
}

processHospitalUrlsFromXml(xmlFilePath)
  .then(() => {
    console.log("Script completed successfully.");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Unexpected error:", err);
    logError(`Unexpected Error: ${err.message}`);
    process.exit(1);
  });

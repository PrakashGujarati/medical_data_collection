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
  "mongodb+srv://prakashgujaratiwork:1h8OT1TBS9710vcy@cluster0.5iu6l.mongodb.net/medipractweb_clinic"; // Replace with your actual MongoDB URI

mongoose
  .connect(MONGODB_URI)
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

const doctorSchema = new mongoose.Schema({
  title: String, // Doctor's name
  specialization: [String],
  uri: String,
});
const Doctor = mongoose.model("Doctor", doctorSchema, "doctors");

/************************************************************
 * 3. Scraping Functions
 ************************************************************/

/**
 * Scrape Hospital Overview
 * @param {puppeteer.Page} page
 * @returns {Object} Hospital Overview Data
 */
// async function scrapeHospitalOverview(page) {
//   try {
//     return await page.evaluate(() => {
//       const getText = (selector) => {
//         const element = document.querySelector(selector);
//         return element ? element.innerText.trim() : null;
//       };

//       const getHref = (selector) => {
//         const element = document.querySelector(selector);
//         return element ? element.href : null;
//       };

//       const getImageData = (selector) => {
//         const element = document.querySelector(selector);
//         return element
//           ? {
//               url: element.src.replace("/thumbnail", ""),
//               thumbnail: element.src,
//               alt: element.alt || "Hospital logo",
//             }
//           : null;
//       };

//       return {
//         name: getText('span[data-qa-id="hospital_name"]'),
//         address: getText('p[data-qa-id="address_body"]'),
//         area: getText('h2[data-qa-id="hospital-locality"]'),
//         headline: getText('h2[data-qa-id="hospital_speciality"]'),
//         doctor_count: getText('h2[data-qa-id="doctor_count"]'),
//         image: getImageData('img[data-qa-id="logo"]'),
//         about: getText("p.c-profile__description"),
//         addressUrl: getHref('a[data-qa-id="get_directions"]'),
//         timings_day: getText('p[data-qa-id="clinic-timings-day"]'),
//         timing_session: getText('p[data-qa-id="clinic-timings-session"]'),
//         payment_modes: getText('p[data-qa-id="payment_modes_body"]'),
//       };
//     });
//   } catch (error) {
//     console.error("Error in scrapeHospitalOverview:", error);
//     logError(`scrapeHospitalOverview Error: ${error.message}`);
//     return {};
//   }
// }

function getUriFromUrl(fullUrl) {
  const splitted = fullUrl.split("practo.com");
  return splitted[1] || "";
}

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

      // Extract hospital overview details
      const overview = {
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

      // Extract doctors details
      const doctorElements = document.querySelectorAll(
        'div[data-qa-id="doctor_card_default"]'
      );
      const doctors = Array.from(doctorElements).map((doctor) => {
        // Extract raw profile URL
        let rawUrl = doctor.querySelector("div.c-card-info a")?.href || null;
        // Remove the "https://www.practo.com/" prefix if present
        const doctorProfileUrl = rawUrl
          ? rawUrl.replace("https://www.practo.com/", "")
          : null;

        return {
          name:
            doctor
              .querySelector('h2[data-qa-id="doctor_name"]')
              ?.innerText.trim() || null,
          specialization:
            doctor
              .querySelector('h3[data-qa-id="doctor_specialisation"]')
              ?.innerText.trim() || null,
          experience:
            doctor
              .querySelector('h3[data-qa-id="doctor_experience"]')
              ?.innerText.trim() || null,
          fee:
            doctor
              .querySelector('span[data-qa-id="consultation_fee"]')
              ?.innerText.trim() || null,
          timings:
            doctor
              .querySelector('span[data-qa-id="doctor_visit_timings"]')
              ?.innerText.trim() || null,
          doctorProfileUrl, // Use the modified URL
        };
      });
      // Combine overview and doctors array
      return {
        ...overview,
        doctors,
      };
    });
  } catch (error) {
    console.error("Error in scrapeHospitalOverview:", error);
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
// async function scrapeHospitalPhotos(page) {
//   const photos = [];

//   try {
//     // Selector for the photo button or image
//     const photoButtonSelector = 'img[data-qa-id="doctor-clinics-photo"]';

//     // Ensure photos container is loaded
//     await page.waitForSelector(photoButtonSelector, { timeout: 10000 });

//     // Click on the photo to open the gallery if applicable
//     const photoButton = await page.$(photoButtonSelector);
//     if (photoButton) {
//       await Promise.all([
//         page.waitForNavigation({
//           waitUntil: "domcontentloaded",
//           timeout: 10000,
//         }),
//         photoButton.click(),
//       ]);
//     }

//     // Extract clinic photos
//     const scrapedPhotos = await page.evaluate(() => {
//       return Array.from(
//         document.querySelectorAll("img.c-carousel--item__large")
//       ).map((img) => ({
//         url: img.src,
//         alt: img.alt || "N/A",
//       }));
//     });

//     photos.push(...scrapedPhotos);
//   } catch (error) {
//     console.error("Error in scrapeHospitalPhotos:", error);
//     logError(`scrapeHospitalPhotos Error: ${error.message}`);
//   }

//   return photos;
// }
async function scrapeHospitalPhotos(url) {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
      timeout: 30000,
    });

    const page = await browser.newPage();
    await page.setDefaultNavigationTimeout(30000);
    console.log(`Navigating to URL: ${url}`);
    await page.goto(url, { waitUntil: "domcontentloaded" });

    // Wait for the first image to load gracefully
    const firstImageSelector = 'img[data-qa-id="doctor-clinics-photo"]';
    console.log("Waiting for the first image...");

    try {
      await page.waitForSelector(firstImageSelector, { timeout: 30000 });
    } catch (waitError) {
      console.log("No clinic photos found on the page.");
      return { hospitalPhotos: [] }; // Return empty photos gracefully
    }

    // Click on the first image to open the gallery
    console.log("Clicking the first image...");
    await page.click(firstImageSelector);

    // Wait for the high-resolution images in the gallery to load gracefully
    const highResSelector = "img.c-carousel--item__large";
    console.log("Waiting for high-resolution images...");

    try {
      await page.waitForSelector(highResSelector, { timeout: 15000 });
    } catch (highResError) {
      console.log("High-resolution images not found.");
      return { hospitalPhotos: [] }; // Return empty photos gracefully
    }

    // Extract all high-resolution image URLs and alt texts
    const hospitalPhotos = await page.evaluate(() => {
      return Array.from(
        document.querySelectorAll("img.c-carousel--item__large")
      ).map((img) => ({
        url: img.src,
        alt: img.alt || "N/A",
      }));
    });

    return { hospitalPhotos };
  } catch (error) {
    console.error(`Error in scrapeHospitalPhotos for ${url}:`, error);
    return { hospitalPhotos: [] }; // Return an empty structure on error
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

// async function scrapeHospitalPhotos(url) {
//   let browser;
//   try {
//     browser = await puppeteer.launch({
//       headless: true,
//       args: ["--no-sandbox", "--disable-setuid-sandbox"],
//       timeout: 30000,
//     });

//     const page = await browser.newPage();
//     await page.setDefaultNavigationTimeout(30000);
//     console.log(`Navigating to URL: ${url}`);
//     await page.goto(url, { waitUntil: "domcontentloaded" });

//     // Wait for the first image to load
//     const firstImageSelector = 'img[data-qa-id="doctor-clinics-photo"]';
//     console.log("Waiting for the first image...");
//     await page.waitForSelector(firstImageSelector, { timeout: 30000 });

//     // Click on the first image to open the gallery
//     console.log("Clicking the first image...");
//     await page.click(firstImageSelector);

//     // Wait for the high-resolution images in the gallery to load
//     const highResSelector = "img.c-carousel--item__large";
//     console.log("Waiting for high-resolution images...");
//     await page.waitForSelector(highResSelector, { timeout: 30000 });

//     // Extract all high-resolution image URLs and alt texts
//     const hospitalPhotos = await page.evaluate(() => {
//       return Array.from(
//         document.querySelectorAll("img.c-carousel--item__large")
//       ).map((img) => ({
//         url: img.src,
//         alt: img.alt || "N/A",
//       }));
//     });

//     // console.log("Extracted photos:", hospitalPhotos);
//     return { hospitalPhotos };
//   } catch (error) {
//     console.error(`Error in scrapeHospitalPhotos for ${url}:`, error);
//     return null;
//   } finally {
//     if (browser) {
//       await browser.close();
//     }
//   }
// }

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
      /* ... */
    });
    const page = await browser.newPage();
    await page.setDefaultNavigationTimeout(60000);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });

    // Scrape hospital overview including doctors
    const scrapedData = await scrapeHospitalOverview(page);
    const { doctors: doctors, ...overview } = scrapedData;

    // Process each doctor from the scraped data
    for (const doc of doctors) {
      if (!doc.name || !doc.specialization) {
        continue;
      }

      console.log("Processing doctor:", doc.name);

      let foundDoctor;
      try {
        foundDoctor = await Doctor.findOne({
          title: {
            $regex: `^${doc.name.trim()}$`,
            $options: "i",
          },
          specialization: {
            $elemMatch: {
              $regex: `${doc.specialization.trim()}`,
              $options: "i",
            },
          },
        });
      } catch (err) {
        logError(`Error querying doctor ${doc.name}: ${err.message}`);
        continue;
      }

      if (foundDoctor) {
        // Update URI if needed
        if (doc.doctorProfileUrl) {
          const partialUri = getUriFromUrl(doc.doctorProfileUrl);
          foundDoctor.uri = partialUri;
        }
        try {
          await foundDoctor.save();
        } catch (err) {
          logError(`Error saving doctor ${doc.name}: ${err.message}`);
        }
        console.log(
          `Matched existing doctor: ${doc.name}. Updated URI, added to clinic.`
        );
      } else {
        console.log(
          `Doctor not found: ${doc.name}. Scraping additional data...`
        );
        try {
          const newDoc = new Doctor({
            title: doc.name,
            specialization: [doc.specialization],
            uri: doc.doctorProfileUrl
              ? getUriFromUrl(doc.doctorProfileUrl)
              : undefined,
            ...newDoctorDetails,
          });

          await newDoc.save();
          console.log(`New doctor added to 'doctors' collection: ${doc.name}`);
        } catch (err) {
          logError(
            `Error scraping or saving new doctor profile for ${doc.name}: ${err.message}`
          );
        }
      }
      // Optionally, collect data if needed
      // doctorsData.push(doc);
    }

    // Conditional check for stories
    let stories = [];
    try {
      const storiesTabExists = await page.evaluate(() => {
        return Array.from(
          document.querySelectorAll("button.c-btn--unstyled")
        ).some((btn) => btn.innerText.includes("Stories"));
      });
      if (storiesTabExists) {
        stories = await scrapeStories(page);
      } else {
        console.warn("Stories tab not found.");
        logError("Stories tab not found.", url);
      }
    } catch (error) {
      console.error("Error during stories scraping:", error);
      logError(`Stories scraping error: ${error.message}`, url);
    }

    // Conditional check for services
    let services = [];
    try {
      const servicesTabExists = await page.evaluate(() => {
        return Array.from(
          document.querySelectorAll("button.c-btn--unstyled")
        ).some((btn) => btn.innerText.includes("Services"));
      });
      if (servicesTabExists) {
        services = await scrapeServices(page);
      } else {
        console.warn("Services tab not found.");
        logError("Services tab not found.", url);
      }
    } catch (error) {
      console.error("Error during services scraping:", error);
      logError(`Services scraping error: ${error.message}`, url);
    }

    // Conditional check for photos
    let photos = [];
    // const hasPhotos =
    //   (await page.$('img[data-qa-id="doctor-clinics-photo"]')) !== null;
    // if (hasPhotos) {
    //   photos = await scrapeHospitalPhotos(url);
    // }
    photos = await scrapeHospitalPhotos(url);

    hospitalDetails = {
      ...overview,
      doctorIds: doctors,
      stories,
      photos,
      services,
    };

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

// async function scrapeHospitalDetails(url) {
//   let browser;
//   let hospitalDetails = null;

//   try {
//     browser = await puppeteer.launch({
//       headless: true,
//       args: ["--no-sandbox", "--disable-setuid-sandbox"],
//       timeout: 60000,
//     });
//     const page = await browser.newPage();

//     // Set a reasonable navigation timeout
//     await page.setDefaultNavigationTimeout(60000);

//     // Navigate to the hospital URL
//     await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });

//     // Scrape hospital overview
//     const overview = await scrapeHospitalOverview(page);

//     // Scrape doctors
//     const doctors = await scrapeDoctors(page);

//     // Scrape stories
//     const stories = await scrapeStories(page);

//     // Scrape services
//     const services = await scrapeServices(page);

//     // Scrape photos
//     const photos = await scrapeHospitalPhotos(page);

//     // Build the final hospital details object
//     hospitalDetails = {
//       ...overview,
//       doctorIds: doctors, // Depending on your schema, you might want to process doctor data differently
//       stories, // If you want to store stories
//       photos,
//       services,
//     };

//     // Save to MongoDB
//     const hospitalDoc = new Hospital(hospitalDetails);
//     await hospitalDoc.save();
//     console.log(`Hospital details saved for URL: ${url}`);
//   } catch (error) {
//     console.error(`Error scraping URL ${url}:`, error);
//     logError(`scrapeHospitalDetails Error: ${error.message}`, url);
//   } finally {
//     if (browser) {
//       await browser.close();
//     }
//   }

//   return hospitalDetails;
// }

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
  // Updated regex to match only main hospital URLs without trailing paths
  const hospitalUrlRegex =
    /^https:\/\/www\.practo\.com\/[^\/]+\/hospital\/[^\/]+\/?$/;
  for (const entry of urlEntries) {
    if (entry.loc && Array.isArray(entry.loc) && entry.loc[0]) {
      const url = entry.loc[0];
      // Use the refined regex to match only primary hospital URLs
      if (hospitalUrlRegex.test(url)) {
        hospitalUrls.add(url);
      }
    }
  }

  console.log(`Found ${hospitalUrls.size} hospital URLs to process.`);

  // Loop over each hospital URL and perform scraping or processing
  for (const url of hospitalUrls) {
    console.log(`Processing Hospital URL: ${url}`);
    try {
      // Invoke your scraping function here when ready
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

// async function runScrape() {
//   try {
//     await scrapeHospitalDetails(
//       "https://www.practo.com/rajkot/hospital/sterling-hospital-raiya-1?referrer=hospital_listing"
//     );
//     process.exit(0);
//   } catch (error) {
//     console.error(`Error processing URL:`, error);
//   }
// }

// runScrape();

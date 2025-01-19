const mongoose = require("mongoose");
const puppeteer = require("puppeteer");
const fs = require("fs");
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
  "mongodb+srv://medipractinfo:cFcK1u7cdJACr2Dk@medipract.vpxxvy1.mongodb.net/medipractweb"; // Update to your DB URI

mongoose.connect(MONGODB_URI).catch((err) => {
  console.error("MongoDB connection error:", err);
  logError(`MongoDB connection error: ${err.message}`);
});

/************************************************************
 * 2. Example Mongoose Schemas and Models
 *    Adapt these to match your own schema definitions!
 ************************************************************/
const doctorSchema = new mongoose.Schema({
  title: String, // Doctor's name
  specialization: [String],
  uri: String,
});
const Doctor = mongoose.model("Doctor", doctorSchema, "doctors");

const clinicSchema = new mongoose.Schema({
  name: String,
  doctorIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Doctor" }],
  rating: Number,
  feedback: String,
  services: [String],
  faqs: [
    {
      question: String,
      answer: String,
    },
  ],
  photos: [
    {
      url: String,
      alt: String,
    },
  ],
  area: String,
  address: String,
  city: String,
  about: String,
});
const Clinic = mongoose.model("Clinic", clinicSchema, "clinics");

/************************************************************
 * 3. Utility function to extract the partial URI
 ************************************************************/
function getUriFromUrl(fullUrl) {
  const splitted = fullUrl.split("practo.com");
  return splitted[1] || "";
}

/************************************************************
 * 4. Delay Helper
 ************************************************************/
function delay(time) {
  return new Promise((resolve) => setTimeout(resolve, time));
}

/************************************************************
 * 5. Scrape Clinic Overview
 ************************************************************/
async function scrapeClinicOverview(page) {
  try {
    return await page.evaluate(() => {
      const getText = (selector) => {
        const element = document.querySelector(selector);
        return element ? element.innerText.trim() : "N/A";
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

      const getAllText = (selector) => {
        const elements = document.querySelectorAll(selector);
        return elements.length > 0
          ? Array.from(elements)
              .map((el) => el.innerText.trim())
              .join("\n")
          : "N/A";
      };

      const getHref = (selector) => {
        const element = document.querySelector(selector);
        return element ? element.href : null;
      };

      const breadcrumbs = Array.from(
        document.querySelectorAll("a.c-breadcrumb__title")
      )
        .map((el) => el?.innerText.trim())
        .filter((text) => text.length > 0);

      const city = breadcrumbs.length > 1 ? breadcrumbs[1] : "";

      return {
        name: getText('h1[data-qa-id="clinic-name"]'),
        headline: getText('h2[data-qa-id="clinic-speciality"]'),
        rating: parseFloat(
          getText('div[data-qa-id="star_rating"] .common__star-rating__value')
        ),
        feedback: getText('span[data-qa-id="clinic-votes"]'),
        area: getText('h2[data-qa-id="clinic-locality"]'),
        address: getText('p[data-qa-id="clinic-address"]'),
        logo: getImageData('img[data-qa-id="clinic-image"]'),
        addressUrl: getHref('a[data-qa-id="get_directions"]'),
        about: getText("p.c-profile__description"),
        timings_day: getText('p[data-qa-id="clinic-timings-day"]'),
        timings_session: getAllText('p[data-qa-id="clinic-timings-session"]'),
        breadcrumbs,
        city,
      };
    });
  } catch (err) {
    logError(`Error in scrapeClinicOverview: ${err.message}`);
    return {}; // Return an empty object on failure
  }
}

/************************************************************
 * 6. Scrape Doctors (with Mongoose logic for matching)
 ************************************************************/
async function scrapeDoctors(page, clinicInstance) {
  const doctorsData = [];

  try {
    // Use a 3000 ms timeout for waiting on selectors
    await page.waitForSelector('a[href*="doctors"]', {
      visible: true,
      timeout: 3000,
    });
    const doctorsTabSelector = 'li[data-qa-id="doctors-tab"] button';
    await page.waitForSelector(doctorsTabSelector, {
      visible: true,
      timeout: 3000,
    });
    await page.click(doctorsTabSelector);

    await page.waitForSelector('div[data-qa-id="doctor_card_default"]', {
      timeout: 3000,
    });

    while (true) {
      try {
        const loadMoreButton = await page.$(
          'button[data-qa-id="view-more-doctors"]'
        );
        if (!loadMoreButton) break;

        await Promise.all([
          page.waitForResponse((response) => response.status() === 200, {
            timeout: 3000,
          }),
          loadMoreButton.click(),
        ]);
        await page.waitForTimeout(1000);
      } catch (err) {
        logError(`Error clicking load more doctors: ${err.message}`);
        break;
      }
    }

    const scrapedDoctors = await page.evaluate(() => {
      const doctorElements = document.querySelectorAll(
        'div[data-qa-id="doctor_card_default"]'
      );
      return Array.from(doctorElements).map((doctor) => ({
        doctorProfileUrl:
          doctor.querySelector(
            "div.o-media__body .c-card-info a.u-color--primary"
          )?.href || "N/A",
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

    for (const doc of scrapedDoctors) {
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
      }

      if (foundDoctor) {
        const partialUri = getUriFromUrl(doc.doctorProfileUrl);
        foundDoctor.uri = partialUri;
        try {
          await foundDoctor.save();
        } catch (err) {
          logError(`Error saving doctor ${doc.name}: ${err.message}`);
        }

        clinicInstance.doctorIds.push(foundDoctor._id);
        console.log(
          `Matched existing doctor: ${doc.name}. Updated URI, added to clinic.`
        );
      } else {
        console.log(
          `Doctor not found: ${doc.name}. Scraping additional data...`
        );
        try {
          const newDoctorDetails = await scrapeIndividualDoctorProfile(
            doc.doctorProfileUrl
          );

          const newDoc = new Doctor({
            title: doc.name,
            specialization: [doc.specialization],
            uri: getUriFromUrl(doc.doctorProfileUrl),
            ...newDoctorDetails,
          });

          await newDoc.save();
          console.log(`New doctor added to 'doctors' collection: ${doc.name}`);
          clinicInstance.doctorIds.push(newDoc._id);
        } catch (err) {
          logError(
            `Error scraping or saving new doctor profile for ${doc.name}: ${err.message}`
          );
        }
      }
      doctorsData.push(doc);
    }
  } catch (error) {
    logError(`Error in scrapeDoctors: ${error.message}`);
  }
  return doctorsData;
}

/************************************************************
 * 7. Scrape Individual Doctor Profile
 ************************************************************/
async function scrapeIndividualDoctorProfile(doctorProfileUrl) {
  let docBrowser;
  let docPage;
  let dataToReturn = {};

  if (!doctorProfileUrl || doctorProfileUrl === "N/A") {
    return dataToReturn;
  }

  try {
    docBrowser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
      timeout: 3000,
    });
    docPage = await docBrowser.newPage();
    await docPage.setDefaultNavigationTimeout(3000);
    await docPage.goto(doctorProfileUrl, { waitUntil: "domcontentloaded" });

    dataToReturn = await docPage.evaluate(() => {
      const details = {};
      const educationEl = document.querySelector(
        "div[data-qa-id='doctor-education']"
      );
      details.education = educationEl ? educationEl.innerText.trim() : null;
      return details;
    });
  } catch (err) {
    logError(
      `Error in scrapeIndividualDoctorProfile (${doctorProfileUrl}): ${err.message}`
    );
  } finally {
    if (docBrowser) {
      await docBrowser.close();
    }
  }

  return dataToReturn;
}

/************************************************************
 * 8. Scrape Services
 ************************************************************/
async function scrapeServices(page) {
  const services = [];

  try {
    await delay(2000);
    const serviceTab = await page.evaluateHandle(() => {
      const tabs = Array.from(
        document.querySelectorAll("li[data-qa-id='services-tab'] button")
      );
      return tabs.find((tab) => tab.innerText.includes("Services"));
    });

    if (serviceTab) {
      await Promise.all([
        page.waitForNavigation({
          waitUntil: "domcontentloaded",
          timeout: 3000,
        }),
        serviceTab.asElement().click(),
      ]);

      const viewAllButton = await page.evaluateHandle(() => {
        const buttons = Array.from(
          document.querySelectorAll("button[data-qa-id='entity-toggle']")
        );
        return buttons.find((button) => button.innerText.includes("View all"));
      });

      if (viewAllButton) {
        await Promise.all([
          page.waitForSelector('div[data-qa-id="services-item"]', {
            timeout: 3000,
          }),
          viewAllButton.asElement().click(),
        ]);

        services.push(
          ...(await page.evaluate(() => {
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
          }))
        );
      } else {
        logError("View All button not found in scrapeServices.");
      }
    } else {
      logError("Services tab not found in scrapeServices.");
    }
  } catch (error) {
    logError(`Error in scrapeServices: ${error.message}`);
  }

  return services;
}

/************************************************************
 * 9. Scrape Questions (FAQ)
 ************************************************************/
async function scrapeQuestions(page) {
  const questionsAndAnswers = [];

  try {
    const questionsTabSelector = "li[data-qa-id='questions-tab'] button";
    await page.waitForSelector(questionsTabSelector, {
      visible: true,
      timeout: 3000,
    });

    const questionsTab = await page.evaluateHandle(() => {
      const buttons = Array.from(
        document.querySelectorAll("li[data-qa-id='questions-tab'] button")
      );
      return buttons.find((button) => button.innerText.includes("Questions"));
    });

    if (questionsTab) {
      await Promise.all([
        page.waitForNavigation({
          waitUntil: "domcontentloaded",
          timeout: 3000,
        }),
        questionsTab.asElement().click(),
      ]);

      await page.waitForSelector("div[data-qa-id='faq-section']", {
        timeout: 3000,
      });

      questionsAndAnswers.push(
        ...(await page.evaluate(() => {
          const faqElements = document.querySelectorAll(
            "div[data-qa-id='individual-faq']"
          );
          return Array.from(faqElements).map((faq) => {
            const question = faq
              .querySelector("p[data-qa-id='faq-question']")
              ?.innerText.trim();
            const answer = faq
              .querySelector("div[data-qa-id='faq-answer'] span.u-bold + span")
              ?.innerText.trim();
            return { question, answer };
          });
        }))
      );
    } else {
      logError("Questions tab not found in scrapeQuestions.");
    }
  } catch (error) {
    logError(`Error in scrapeQuestions: ${error.message}`);
  }

  return questionsAndAnswers;
}

/************************************************************
 * 10. Scrape Clinic Photos
 ************************************************************/
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

/************************************************************
 * 11. Scrape Full Clinic Detail
 ************************************************************/
async function scrapeClinicDetail(url) {
  let browser;
  let clinicInstance = new Clinic();

  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox"],
      timeout: 3000,
    });
    const page = await browser.newPage();
    await page.setDefaultNavigationTimeout(3000);

    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 3000 });
    } catch (navError) {
      const message = `Navigation error for URL: ${url} - ${navError.message}`;
      console.error(message);
      logError(message, url);
      return; // Skip further processing for this URL
    }

    // Check if the Doctors tab exists. If not, skip further scraping.
    const doctorTabExists = await page.$('li[data-qa-id="doctors-tab"] button');
    if (!doctorTabExists) {
      const message = `Doctors tab not found for URL: ${url}. Skipping scrape.`;
      console.log(message);
      logError(message, url);
      return;
    }

    const clinicOverview = await scrapeClinicOverview(page);
    clinicInstance.name = clinicOverview.name || clinicInstance.name;
    clinicInstance.rating = clinicOverview.rating || clinicInstance.rating;
    clinicInstance.feedback =
      clinicOverview.feedback || clinicInstance.feedback;
    clinicInstance.area = clinicOverview.area || clinicInstance.area;
    clinicInstance.address = clinicOverview.address || clinicInstance.address;
    clinicInstance.city = clinicOverview.city || clinicInstance.city;
    clinicInstance.about = clinicOverview.about || clinicInstance.about;

    const doctorsTabSelector = 'li[data-qa-id="doctors-tab"] button';
    try {
      await page.waitForSelector(doctorsTabSelector, { timeout: 3000 });
      console.log("Doctors tab is available.");
      // Perform actions related to doctors tab here
      await scrapeDoctors(page, clinicInstance);
    } catch (error) {
      console.warn("Doctors tab not found within 3000ms.");
    }

    // Check for services tab buttons existence using querySelectorAll
    try {
      await page.waitForFunction(
        () =>
          document.querySelectorAll("li[data-qa-id='services-tab'] button")
            .length > 0,
        { timeout: 3000 }
      );
      console.log("Services tab buttons are available.");
      // Perform actions related to services tab here
      const services = await scrapeServices(page);
      clinicInstance.services = services.length
        ? services
        : clinicInstance.services;
    } catch (error) {
      console.warn("Services tab buttons not found within 3000ms.");
    }

    // Check for serviceElements
    try {
      await page.waitForFunction(
        () =>
          document.querySelectorAll('div[data-qa-id="services-item"]').length >
          0,
        { timeout: 3000 }
      );
      console.log("Service elements are available.");
      // Perform actions related to service elements here
      const faqs = await scrapeQuestions(page);
      clinicInstance.faqs = faqs.length ? faqs : clinicInstance.faqs;
    } catch (error) {
      console.warn("Service elements not found within 3000ms.");
    }

    // Check for image selector
    const imageSelector = 'img[data-qa-id="doctor-clinics-photo"]';
    try {
      await page.waitForSelector(imageSelector, { timeout: 3000 });
      console.log("Doctor clinic photo image is available.");
      // Perform actions related to the image here
      const clinicImages = await scrapeClinicPhotos(url);
      const photos = clinicImages ? clinicImages.clinicPhotos : [];
      clinicInstance.photos = photos.length ? photos : clinicInstance.photos;
    } catch (error) {
      console.warn("Doctor clinic photo image not found within 3000ms.");
    }

    try {
      await clinicInstance.save();
      console.log("Clinic instance saved for:", url);
    } catch (saveError) {
      logError(`Error saving clinic instance for ${url}: ${saveError.message}`);
    }

    return clinicInstance;
  } catch (error) {
    logError(`Error in scrapeClinicDetail for ${url}: ${error.message}`);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

async function processClinicUrlsFromXml(xmlFilePath) {
  // Read XML file
  let xmlData;
  try {
    xmlData = fs.readFileSync(xmlFilePath, "utf8");
  } catch (readError) {
    console.error(`Error reading XML file (${xmlFilePath}):`, readError);
    return;
  }

  // Parse XML to JS object with less strict settings
  let parsedXml;
  try {
    const parser = new xml2js.Parser({ strict: false, normalizeTags: true });
    parsedXml = await parser.parseStringPromise(xmlData);
  } catch (error) {
    console.error(`Failed to parse XML file (${xmlFilePath}):`, error);
    return;
  }

  // Extract clinic URLs
  const clinicUrls = new Set();
  const urlEntries = (parsedXml.urlset && parsedXml.urlset.url) || [];
  for (const entry of urlEntries) {
    if (entry.loc && Array.isArray(entry.loc) && entry.loc[0]) {
      const url = entry.loc[0];
      const match = url.match(
        /^https:\/\/www\.practo\.com\/[^\/]+\/clinic\/[^\/]+$/
      );
      if (match) {
        clinicUrls.add(url);
      }
    }
  }

  console.log(
    `Found ${clinicUrls.size} clinic URLs in ${xmlFilePath} to process.`
  );

  // Log and process each filtered clinic URL
  for (const url of clinicUrls) {
    console.log(`Clinic URL: ${url}`);
    try {
      await scrapeClinicDetail(url);
    } catch (error) {
      console.error(`Error processing ${url}:`, error);
    }
  }

  console.log(`Finished processing file: ${xmlFilePath}`);
}

/************************************************************
 * Entry point
 ************************************************************/
async function main() {
  const baseFolder = "output-titan-india-clinic-profiles-0-sitemap";
  const filePrefix = "titan-india-clinic-profiles-0-sitemap-";
  const fileSuffix = ".xml";

  // Read range (start and end) from command-line arguments
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error("Please provide start and end numbers for the file range.");
    console.error("Usage: node yourScript.js <start> <end>");
    process.exit(1);
  }

  const start = parseInt(args[0], 10);
  const end = parseInt(args[1], 10);

  if (isNaN(start) || isNaN(end) || start > end) {
    console.error(
      "Invalid range provided. Ensure start and end are valid numbers with start <= end."
    );
    process.exit(1);
  }

  // Dynamically generate file paths based on the provided range
  const xmlFilePaths = [];
  for (let i = start; i <= end; i++) {
    xmlFilePaths.push(`${baseFolder}/${filePrefix}${i}${fileSuffix}`);
  }

  for (const xmlFilePath of xmlFilePaths) {
    await processClinicUrlsFromXml(xmlFilePath);
  }

  console.log("All files have been processed.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});

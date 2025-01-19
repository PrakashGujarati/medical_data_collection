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
  "mongodb+srv://prakashgujaratiwork:1h8OT1TBS9710vcy@cluster0.5iu6l.mongodb.net/medipractweb_clinic"; // Update to your DB URI

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
  headline: String,
  rating: Number,
  feedback: String,
  area: String,
  address: String,

  // Inline object for logo
  logo: [
    {
      url: String,
      thumbnail: String,
      alt: String,
    },
  ],

  clinicUrl: String,
  addressUrl: String,
  about: String,
  timings_day: String,
  timings_session: String,

  // Array of strings for breadcrumbs
  breadcrumbs: [String],

  city: String,

  // Array of doctors (subdocuments inlined)
  // doctors: [
  //   {
  //     doctorProfileUrl: String,
  //     name: String,
  //     specialization: String,
  //     experience: String,
  //     fee: String,
  //     timings: String,
  //   },
  // ],

  // Array of mongoose ObjectIds for doctors
  doctorIds: [
    {
      type: mongoose.Schema.Types.ObjectId,
      // Optionally, you can add a reference if these IDs correspond to another collection, e.g.:
      // ref: 'Doctor'
    },
  ],

  // Array of services (strings)
  services: [String],

  // Array of photos (subdocuments inlined)
  photos: [
    {
      url: String,
      alt: String,
    },
  ],

  // Array of FAQs (subdocuments inlined)
  faqs: [
    {
      question: String,
      answer: String,
    },
  ],
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
async function scrapeClinicOverview(url) {
  let browser;
  try {
    // 1) Launch Puppeteer WITHOUT a forced 3s timeout
    //    (Removing `timeout: 15000` to avoid "Timed out after 15000 ms" errors)
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox"],
    });

    const page = await browser.newPage();

    // 2) Increase the navigation timeout to e.g. 10 seconds
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 10000 });
    } catch (navError) {
      console.error(`Navigation error for URL: ${url} - ${navError.message}`);
      return null; // Stop if navigation fails
    }

    // 3) Wait for a specific element that indicates the page has loaded
    //    (Adjust selector and timeout as needed)
    await page.waitForSelector('h1[data-qa-id="clinic-name"]', {
      timeout: 8000,
    });

    // 4) Scrape data by evaluating the DOM
    const scrapedData = await page.evaluate(() => {
      const imageElements = document.querySelectorAll(
        'img[data-qa-id="clinic-image"]'
      );
      const logo = Array.from(imageElements).map((img) => ({
        url: img.src.replace("/thumbnail", ""),
        thumbnail: img.src,
        alt: img.alt || "Hospital logo",
      }));

      // Extract values from the page
      const name =
        document
          .querySelector('h1[data-qa-id="clinic-name"]')
          ?.innerText.trim() || "N/A";
      const rating = parseFloat(
        document
          .querySelector(
            'div[data-qa-id="star_rating"] .common__star-rating__value'
          )
          ?.innerText.trim() || "0"
      );
      const feedback =
        document
          .querySelector('span[data-qa-id="clinic-votes"]')
          ?.innerText.trim() || "N/A";
      const area =
        document
          .querySelector('h2[data-qa-id="clinic-locality"]')
          ?.innerText.trim() || "N/A";
      const address =
        document
          .querySelector('p[data-qa-id="clinic-address"]')
          ?.innerText.trim() || "N/A";

      // "Get Directions" URL
      const addressUrl =
        document.querySelector('a[data-qa-id="get_directions"]')?.href.trim() ||
        "N/A";

      // Headline
      const headline =
        document
          .querySelector('h2[data-qa-id="summary_title"]')
          ?.innerText.trim() || "N/A";

      // Timings
      const timings_day =
        document
          .querySelector('p[data-qa-id="clinic-timings-day"]')
          ?.innerText.trim() || "N/A";

      // Extract multiple session timings and join with newlines
      const timingsSessionElements = document.querySelectorAll(
        'p[data-qa-id="clinic-timings-session"]'
      );
      const timings_session = timingsSessionElements.length
        ? Array.from(timingsSessionElements)
            .map((el) => el.innerText.trim())
            .join("\n")
        : "N/A";

      // About text
      const about =
        document.querySelector("p.c-profile__description")?.innerText.trim() ||
        "N/A";

      // Breadcrumbs and City extraction
      const breadcrumbElements = Array.from(
        document.querySelectorAll("a.c-breadcrumb__title")
      )
        .map((el) => el.innerText.trim())
        .filter((text) => text.length > 0);
      const breadcrumbs = breadcrumbElements;
      const city = breadcrumbs.length > 1 ? breadcrumbs[1] : "";

      // Return collected data
      return {
        name,
        headline,
        rating,
        feedback,
        area,
        address,
        logo,
        addressUrl,
        about,
        timings_day,
        timings_session,
        breadcrumbs,
        city,
      };
    });

    // console.log("Scraped data:", scrapedData);
    return scrapedData;
  } catch (err) {
    console.error("Error in getDataFromUrl:", err);
    return null;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

/************************************************************
 * 6. Scrape Doctors (with Mongoose logic for matching)
 ************************************************************/
async function scrapeDoctors(page, clinicInstance) {
  const doctorsData = [];

  try {
    // Use a 15000 ms timeout for waiting on selectors
    await page.waitForSelector('a[href*="doctors"]', {
      visible: true,
      timeout: 5000,
    });
    const doctorsTabSelector = 'li[data-qa-id="doctors-tab"] button';
    await page.waitForSelector(doctorsTabSelector, {
      visible: true,
      timeout: 5000,
    });
    await page.click(doctorsTabSelector);

    await page.waitForSelector('div[data-qa-id="doctor_card_default"]', {
      timeout: 5000,
    });

    while (true) {
      try {
        const loadMoreButton = await page.$(
          'button[data-qa-id="view-more-doctors"]'
        );
        if (!loadMoreButton) break;

        await Promise.all([
          page.waitForResponse((response) => response.status() === 200, {
            timeout: 5000,
          }),
          loadMoreButton.click(),
        ]);
        await page.waitForTimeout(2000);
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
      timeout: 15000,
    });
    docPage = await docBrowser.newPage();
    await docPage.setDefaultNavigationTimeout(15000);
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
          timeout: 15000,
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
            timeout: 15000,
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
      timeout: 15000,
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
          timeout: 15000,
        }),
        questionsTab.asElement().click(),
      ]);

      await page.waitForSelector("div[data-qa-id='faq-section']", {
        timeout: 15000,
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
      timeout: 15000,
    });
    const page = await browser.newPage();
    await page.setDefaultNavigationTimeout(15000);
    await page.goto(url, { waitUntil: "domcontentloaded" });

    const firstImageSelector = 'img[data-qa-id="doctor-clinics-photo"]';
    await page.waitForSelector(firstImageSelector, { timeout: 15000 });
    await page.click(firstImageSelector);
    await delay(15000);

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
      timeout: 15000,
    });
    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(15000);

    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
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

    const clinicOverview = await scrapeClinicOverview(url);
    // Assign each field from `clinicOverview` to `clinicInstance` only if the scraped value is truthy.
    clinicInstance.name = clinicOverview.name || clinicInstance.name;
    clinicInstance.headline =
      clinicOverview.headline || clinicInstance.headline;
    clinicInstance.rating = clinicOverview.rating || clinicInstance.rating;
    clinicInstance.feedback =
      clinicOverview.feedback || clinicInstance.feedback;
    clinicInstance.area = clinicOverview.area || clinicInstance.area;
    clinicInstance.address = clinicOverview.address || clinicInstance.address;
    clinicInstance.logo = clinicOverview.logo || clinicInstance.logo;
    clinicInstance.addressUrl =
      clinicOverview.addressUrl || clinicInstance.addressUrl;
    clinicInstance.about = clinicOverview.about || clinicInstance.about;
    clinicInstance.timings_day =
      clinicOverview.timings_day || clinicInstance.timings_day;
    clinicInstance.timings_session =
      clinicOverview.timings_session || clinicInstance.timings_session;
    clinicInstance.breadcrumbs =
      clinicOverview.breadcrumbs || clinicInstance.breadcrumbs;
    clinicInstance.city = clinicOverview.city || clinicInstance.city;    

    const doctorsTabSelector = 'li[data-qa-id="doctors-tab"] button';
    try {
      await page.waitForSelector(doctorsTabSelector, { timeout: 12000 });
      console.log("Doctors tab is available.");
      // Perform actions related to doctors tab here
      await scrapeDoctors(page, clinicInstance);
    } catch (error) {
      console.warn("Doctors tab not found within 12000ms.");
    }

    // Check for services tab buttons existence using querySelectorAll
    try {
      await page.waitForFunction(
        () =>
          document.querySelectorAll("li[data-qa-id='services-tab'] button")
            .length > 0,
        { timeout: 15000 }
      );
      console.log("Services tab buttons are available.");
      // Perform actions related to services tab here
      const services = await scrapeServices(page);
      clinicInstance.services = services.length
        ? services
        : clinicInstance.services;
    } catch (error) {
      console.warn("Services tab buttons not found within 15000ms.");
    }

    // Check for serviceElements
    try {
      await page.waitForFunction(
        () =>
          document.querySelectorAll('div[data-qa-id="services-item"]').length >
          0,
        { timeout: 15000 }
      );
      console.log("Service elements are available.");
      // Perform actions related to service elements here
      const faqs = await scrapeQuestions(page);
      clinicInstance.faqs = faqs.length ? faqs : clinicInstance.faqs;
    } catch (error) {
      console.warn("Service elements not found within 15000ms.");
    }

    clinicInstance.clinicUrl = "";
    // Check for image selector
    const clinicImages = await scrapeClinicPhotos(url);
    const photos = clinicImages ? clinicImages.clinicPhotos : [];
    clinicInstance.photos = photos.length ? photos : clinicInstance.photos;
    clinicInstance.clinicUrl = url.replace("https://www.practo.com/","");

    // console.log(clinicInstance);
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
    console.error("Error reading XML file:", readError);
    return;
  }

  // Parse XML to JS object with less strict settings
  let parsedXml;
  try {
    const parser = new xml2js.Parser({ strict: false, normalizeTags: true });
    parsedXml = await parser.parseStringPromise(xmlData);
  } catch (error) {
    console.error("Failed to parse XML:", error);
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

  console.log(`Found ${clinicUrls.size} clinic URLs to process.`);

  // Log each filtered clinic URL
  for (const url of clinicUrls) {
    console.log(`Clinic URL: ${url}`);
    try {
      await scrapeClinicDetail(url);
    } catch (error) {
      console.error(`Error processing ${url}:`, error);
    }
  }

  console.log("All clinic URLs have been logged.");
}

/************************************************************
 * Entry point
 ************************************************************/
const xmlFilePath = process.argv[2];
if (!xmlFilePath) {
  console.error("Please provide the XML file path as a command-line argument.");
  process.exit(1);
}

processClinicUrlsFromXml(xmlFilePath)
  .then(() => {
    console.log("Script completed.");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Unexpected error:", err);
    process.exit(1);
  });



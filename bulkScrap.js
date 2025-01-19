const { Cluster } = require("puppeteer-cluster");
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
});
const Doctor = mongoose.model("Doctor", doctorSchema);

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

(async () => {
  // Create a cluster with a specified concurrency level
  const cluster = await Cluster.launch({
    concurrency: Cluster.CONCURRENCY_CONTEXT, // Use separate contexts for each worker
    maxConcurrency: 5, // Limit to 5 parallel tasks; adjust as needed
    puppeteerOptions: { headless: true },
  });

  // Define the task for each cluster job
  await cluster.task(async ({ page, data: url }) => {
    const parts = url.split("/").filter(Boolean);
    const lastSegment = parts[parts.length - 1] || "index";
    const fileName = `${lastSegment}.json`;

    console.log(`Navigating to ${url}`);
    await page.goto(url, { waitUntil: "networkidle2" });
    await sleep(3000);

    const isLoadMoreVisible = async () => {
      return await page.evaluate(() => {
        const button = document.querySelector("#loadmore");
        if (!button) return false;
        const style = window.getComputedStyle(button);
        return (
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
        if (Array.isArray(existingData)) accumulatedData = existingData;
      } catch (e) {
        console.error(`Error reading existing file ${fileName}: ${e}`);
      }
    }

    while (await isLoadMoreVisible()) {
      loadMoreCount++;
      console.log(
        `Clicking "Load More Records" on ${url}, attempt #${loadMoreCount}`
      );

      try {
        await page.evaluate(() => {
          const button = document.querySelector("#loadmore");
          if (button)
            button.scrollIntoView({ behavior: "smooth", block: "center" });
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

        for (let i = 0; i < listings.length; i++) {
          const listing = listings.eq(i);
          const titleTag = listing.find("h3 a");
          const name = titleTag.text().trim() || null;
          const uri = titleTag.attr("href") || null;
          const address = listing.find("p").text().trim() || null;

          if (!accumulatedData.find((item) => item.uri === uri)) {
            const doctorData = { name, address, uri };
            accumulatedData.push(doctorData);

            try {
              const existingDoctor = await Doctor.findOne({ uri });
              if (!existingDoctor) {
                await Doctor.create(doctorData);
                console.log(`Saved doctor to DB: ${name}`);
              } else {
                console.log(`Doctor already in DB: ${name}`);
              }
            } catch (dbError) {
              console.error("Error saving to DB:", dbError);
            }
          }
        }

        if (accumulatedData.length === initialDataCount) {
          console.log("No new data found in this iteration. Breaking loop.");
          break;
        }

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
      `Finished loading records for URL: ${url} after ${loadMoreCount} attempts.`
    );
  });

  // Queue all URLs for processing
  for (const url of urls) {
    cluster.queue(url);
  }

  // Wait for the cluster to finish all tasks
  await cluster.idle();
  await cluster.close();

  console.log("All URLs processed.");
  mongoose.connection.close();
})();

const fs = require("fs");
const path = require("path");
const sax = require("sax");

// Configuration
const MAX_URLS_PER_FILE = 2000;
const XML_EXTENSION = ".xml";

// XML header and footer templates
const xmlHeader = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
    xmlns:xhtml="http://www.w3.org/1999/xhtml"
    xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">`;
const xmlFooter = "</urlset>";

/**
 * Processes a single XML file: splits it into chunks and writes output files.
 * @param {string} inputFilePath - Full path to the input XML file.
 */
function processXmlFile(inputFilePath) {
  const baseName = path.basename(inputFilePath, XML_EXTENSION);
  const OUTPUT_DIR = path.join(process.cwd(), `output-${baseName}`);
  const OUTPUT_PREFIX = baseName + "-";

  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR);
  }

  let fileCount = 1;
  let urlCount = 0;
  let currentUrls = [];
  let currentUrlContent = "";
  let insideUrl = false;

  // Initialize a new SAX parser for this file
  const parser = sax.createStream(true, {});

  parser.on("opentag", (node) => {
    if (node.name === "url") {
      insideUrl = true;
      currentUrlContent = "<url>";
    } else if (insideUrl) {
      const attrs = Object.entries(node.attributes)
        .map(([key, value]) => `${key}="${value}"`)
        .join(" ");
      currentUrlContent += attrs ? `<${node.name} ${attrs}>` : `<${node.name}>`;
    }
  });

  parser.on("text", (text) => {
    if (insideUrl) {
      currentUrlContent += text;
    }
  });

  parser.on("closetag", (tagName) => {
    if (insideUrl) {
      currentUrlContent += `</${tagName}>`;
      if (tagName === "url") {
        insideUrl = false;
        currentUrls.push(currentUrlContent);
        currentUrlContent = "";
        urlCount++;

        if (urlCount === MAX_URLS_PER_FILE) {
          writeChunk(currentUrls, fileCount);
          fileCount++;
          urlCount = 0;
          currentUrls = [];
        }
      }
    }
  });

  parser.on("error", (error) => {
    console.error("Parsing error:", error);
    parser.resume();
  });

  parser.on("end", () => {
    // Write any remaining URLs
    if (currentUrls.length > 0) {
      writeChunk(currentUrls, fileCount);
    }
    console.log(`Finished processing ${inputFilePath}`);
  });

  function writeChunk(urlElements, count) {
    const fileName = path.join(OUTPUT_DIR, `${OUTPUT_PREFIX}${count}.xml`);
    const fileContent = [xmlHeader, ...urlElements, xmlFooter].join("\n");
    fs.writeFileSync(fileName, fileContent, "utf8");
    console.log(`Written: ${fileName}`);
  }

  // Create a read stream and pipe it to the SAX parser
  fs.createReadStream(inputFilePath).pipe(parser);
}

/**
 * Scans the current directory for XML files and processes each.
 */
function processAllXmlFiles() {
  fs.readdir(process.cwd(), (err, files) => {
    if (err) {
      console.error("Error reading directory:", err);
      return;
    }

    // Filter for XML files
    const xmlFiles = files.filter(
      (file) =>
        path.extname(file).toLowerCase() === XML_EXTENSION &&
        fs.statSync(path.join(process.cwd(), file)).isFile()
    );

    if (xmlFiles.length === 0) {
      console.log("No XML files found in the current directory.");
      return;
    }

    // Process each XML file found
    xmlFiles.forEach((file) => {
      const filePath = path.join(process.cwd(), file);
      console.log(`Processing ${filePath}...`);
      processXmlFile(filePath);
    });
  });
}

// Start processing all XML files in the current directory
processAllXmlFiles();

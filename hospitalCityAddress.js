const mongoose = require("mongoose");
const axios = require("axios");

// Replace with your actual MongoDB connection string
const mongoUri =
  "mongodb+srv://prakashgujaratiwork:1h8OT1TBS9710vcy@cluster0.5iu6l.mongodb.net/medipractweb_clinic";

// Connect to MongoDB
mongoose
  .connect(mongoUri, {
    useNewUrlParser: true,
  })
  .then(() => console.log("Connected to MongoDB"))
  .catch((err) => {
    console.error("MongoDB connection error:", err);
    process.exit(1);
  });

// Define Hospital schema and model
const hospitalSchema = new mongoose.Schema({
  addressUrl: String,
  address: String,
  city: String,
  // ... include other fields as needed
});

const Hospital = mongoose.model("Hospital", hospitalSchema);

// Google Geocoding API key and function
const googleApiKey = "AIzaSyD1QD2NpGM--cu3r2Hp-3VKIlVBrAGoX7o"; // Replace with your Google API key

async function getAddressAndCityFromLatLng(lat, lng) {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${googleApiKey}`;

  try {
    const response = await axios.get(url);
    const data = response.data;

    if (data.status === "OK" && data.results.length > 0) {
      const firstResult = data.results[0];
      const fullAddress = firstResult.formatted_address;

      let city = null;
      for (let component of firstResult.address_components) {
        if (component.types.includes("locality")) {
          city = component.long_name;
          break;
        }
      }

      console.log("Full Address:", fullAddress);
      console.log("City:", city || "Not found");
      return { fullAddress, city };
    } else {
      console.error("Geocoding error:", data.status);
      return null;
    }
  } catch (error) {
    console.error("Error fetching geocoding data:", error.message);
    return null;
  }
}

async function updateHospitalAddresses() {
  try {
    // Retrieve hospitals with an addressUrl field
    const hospitals = await Hospital.find({ addressUrl: { $exists: true } });
    if (!hospitals.length) {
      console.log("No hospitals found with an addressUrl.");
      return;
    }

    // Regular expression to extract lat,long from URL
    const regex = /\/([-.\d]+),([-.\d]+)$/;

    for (let hospital of hospitals) {
      const url = hospital.addressUrl;
      const match = url.match(regex);

      if (match) {
        const latitude = match[1];
        const longitude = match[2];
        console.log(`Processing Hospital ID: ${hospital._id}`);
        console.log("Latitude:", latitude, "Longitude:", longitude);

        const result = await getAddressAndCityFromLatLng(latitude, longitude);
        if (result) {
          hospital.address = result.fullAddress;
          hospital.city = result.city;
          await hospital.save();
          console.log(
            `Updated Hospital ID: ${hospital._id} with address and city.`
          );
        }
      } else {
        console.log(
          `Coordinates not found in URL for Hospital ID: ${hospital._id}.`
        );
      }
    }

    console.log("Hospital address updates completed.");
  } catch (err) {
    console.error("Error updating hospital addresses:", err);
  } finally {
    mongoose.disconnect();
  }
}

// Start the update process
updateHospitalAddresses();

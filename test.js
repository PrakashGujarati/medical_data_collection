const axios = require("axios");

// Function to reverse geocode latitude and longitude to get the city using Nominatim
async function getCityFromLatLng(lat, lng) {
  const url = "https://nominatim.openstreetmap.org/reverse";
  const params = {
    lat: lat,
    lon: lng,
    format: "json",
    addressdetails: 1,
  };

  try {
    const response = await axios.get(url, {
      params: params,
      headers: {
        // Provide a User-Agent or email to comply with Nominatim policy
        "User-Agent": "YourAppName/1.0 (your.email@example.com)",
      },
    });

    const data = response.data;

    if (data && data.address) {
      // Depending on the location, different fields may contain the city name
      const address = data.address;
      const city =
        address.city || address.town || address.village || address.hamlet;

      if (city) {
        console.log("City:", city);
        return city;
      } else {
        console.log("City information not found in the response.");
      }
    } else {
      console.error("No address data found.");
    }
  } catch (error) {
    console.error("Error fetching geocoding data:", error.message);
  }
}

async function getAddressAndCityFromLatLng(lat, lng) {
  const apiKey = "AIzaSyD1QD2NpGM--cu3r2Hp-3VKIlVBrAGoX7o"; // Replace with your API key
  const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${apiKey}`;

  try {
    const response = await axios.get(url);
    const data = response.data;

    if (data.status === "OK" && data.results.length > 0) {
      const firstResult = data.results[0];

      // Extract the full formatted address
      const fullAddress = firstResult.formatted_address;

      // Extract the city from address components
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

const url = "https://www.google.com/maps/dir//16.155,76.5317";

// Define a regular expression to match latitude and longitude at the end of the URL
const regex = /\/([-.\d]+),([-.\d]+)$/;
const match = url.match(regex);

if (match) {
  const latitude = match[1];
  const longitude = match[2];
  console.log("Latitude:", latitude);
  console.log("Longitude:", longitude);
  getAddressAndCityFromLatLng(latitude, longitude);
} else {
  console.log("Coordinates not found in URL.");
}

const express = require("express");
const cors = require("cors");
require("dotenv").config();
const { MongoClient, ServerApiVersion } = require("mongodb");
const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.xn5s4uj.mongodb.net/?retryWrites=true&w=majority`;

const client = new MongoClient(uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverApi: ServerApiVersion.v1,
});

async function run() {
  try {
    await client.connect();
    const serviceCollection = client
      .db("doctors_portal")
      .collection("services");
    const bookingCollection = client
      .db("doctors_portal")
      .collection("bookings");

    app.get("/service", async (req, res) => {
      const query = {};
      const cursor = serviceCollection.find(query);
      const services = await cursor.toArray();
      res.send(services);
    });

    // Warning:
    // This is not the proper way to query.
    // After learning more about mongodb, use aggregate lookup, pipeline, match, group

    app.get("/available", async (req, res) => {
      const date = req.query.date;

      // Step 1: Get all services

      const services = await serviceCollection.find().toArray();

      // step 2: Get the booking of that day. Output: [{}, {}, {}, {}, {}, {}, {}, {}, {}, {},]
      const query = { date: date };
      const bookings = await bookingCollection.find(query).toArray();

      // Step 3: For each service
      services.forEach((service) => {
        // Step 4: find bookings for that service. Output: [{}, {}, {}, {}, {}, {}];
        const serviceBookings = bookings.filter(
          (book) => book.treatment === service.name
        );
        // Step 5: select slots for the service Bookings: ['', '', '', '', '', '', '', '', ''];
        const bookedSlots = serviceBookings.map((book) => book.slot);
        // Step 6: select those slots that are not in bookedSlots
        const available = service.slots.filter(
          (slot) => !bookedSlots.includes(slot)
        );
        // Step 7: set available to slots to make it easier
        service.slots = available;
      });
      res.send(services);
    });

    /*
     * API Naming conventions
     * --------------------------------
     * app.get("/booking") // get all the bookings in this collection. or get more than one or by filter
     * app.get("/booking/:id") // get a specific booking in this collection
     * app.post("/booking") // add a new booking/create a new booking
     * app.patch("/booking/:id") // update a specific booking
     * app.delete("/booking") // delete a specific booking
     */

    app.post("/booking", async (req, res) => {
      const booking = req.body;
      const query = {
        treatment: booking.treatment,
        date: booking.date,
        patient: booking.patient,
      };
      const exists = await bookingCollection.findOne(query);
      if (exists) {
        return res.send({ success: false, booking: exists });
      }
      const result = await bookingCollection.insertOne(booking);
      return res.send({ success: true, result });
    });
  } finally {
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello From Doctor Uncle!");
});

app.listen(port, () => {
  console.log(`Doctors App listening on port ${port}`);
});

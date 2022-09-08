const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
require("dotenv").config();
const nodemailer = require("nodemailer");
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

function verifyJWT(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).send({ message: "Unauthorized Access" });
  }
  const token = authHeader.split(" ")[1];
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, function (err, decoded) {
    if (err) {
      return res.status(403).send({ message: "Forbidden Access" });
    }
    req.decoded = decoded;
    next();
  });
}

// Send Grid Authentication
const transporter = nodemailer.createTransport({
  host: "smtp.sendgrid.net",
  port: 587,
  auth: {
    user: "apikey",
    pass: process.env.EMAIL_SENDER_KEY,
  },
});

function sendAppointmentEmail(booking) {
  const { patient, patientName, treatment, date, slot } = booking;
  transporter.sendMail(
    {
      from: process.env.EMAIL_SENDER, // verified sender email
      to: patient, // recipient email
      subject: `Your Appointment for ${treatment} is on ${date} at ${slot} is confirmed`, // Subject line
      text: `Your Appointment for ${treatment} is on ${date} at ${slot} is confirmed`, // plain text body
      html: `
      <div>
        <p>Hello, ${patientName}</p>
        <h3>Your appointment for ${treatment} is confirmed</h3>
        <p>Looking forward to seeing you on ${date} at ${slot}</p>
        <h3>Our Address</h3>
        <p>Dhaka, Bangladesh</p>
        <a href="https://google.com">Learn More</a>
      </div>
      `, // html body
    },
    function (error, info) {
      if (error) {
        console.log(error);
      } else {
        console.log("Email sent: " + info.response);
      }
    }
  );
}

async function run() {
  try {
    await client.connect();
    const serviceCollection = client
      .db("doctors_portal")
      .collection("services");
    const bookingCollection = client
      .db("doctors_portal")
      .collection("bookings");
    const userCollection = client.db("doctors_portal").collection("users");
    const doctorCollection = client.db("doctors_portal").collection("doctors");

    const verifyAdmin = async (req, res, next) => {
      const requester = req.decoded.email;
      const requesterAccount = await userCollection.findOne({
        email: requester,
      });
      if (requesterAccount.role === "admin") {
        next();
      } else {
        res.status(403).send({ message: "Forbidden Access" });
      }
    };

    app.get("/service", async (req, res) => {
      const query = {};
      const cursor = serviceCollection.find(query).project({ name: 1 });
      const services = await cursor.toArray();
      res.send(services);
    });

    app.get("/users", verifyJWT, async (req, res) => {
      const users = await userCollection.find().toArray();
      res.send(users);
    });

    app.get("/admin/:email", async (req, res) => {
      const email = req.params.email;
      const user = await userCollection.findOne({ email: email });
      const isAdmin = user.role === "admin";
      res.send({ admin: isAdmin });
    });

    app.put("/user/admin/:email", verifyJWT, verifyAdmin, async (req, res) => {
      const email = req.params.email;
      const filter = { email: email };
      const updateDoc = {
        $set: { role: "admin" },
      };
      const result = await userCollection.updateOne(filter, updateDoc);
      res.send(result);
    });

    // update or insert user from google sign in
    app.put("/user/:email", async (req, res) => {
      const email = req.params.email;
      const user = req.body;
      const filter = { email: email };
      const options = { upsert: true };
      const updateDoc = {
        $set: user,
      };
      const result = await userCollection.updateOne(filter, updateDoc, options);
      const token = jwt.sign(
        { email: email },
        process.env.ACCESS_TOKEN_SECRET,
        { expiresIn: "1h" }
      );
      res.send({ result, token });
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
     * app.put('/booking/:id') // upsert ==> update (if exists) or insert (if does not exist)
     * app.delete("/booking") // delete a specific booking
     */

    app.get("/booking", verifyJWT, async (req, res) => {
      const patient = req.query.patient;
      const decodedEmail = req.decoded.email;
      if (patient === decodedEmail) {
        const query = { patient: patient };
        const bookings = await bookingCollection.find(query).toArray();
        return res.send(bookings);
      } else {
        return res.status(403).send({ message: "forbidden access" });
      }
    });

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
      console.log("Sending Email");
      sendAppointmentEmail(booking);
      return res.send({ success: true, result });
    });

    app.get("/doctor", verifyJWT, verifyAdmin, async (req, res) => {
      const doctors = await doctorCollection.find({}).toArray();
      res.send(doctors);
    });

    app.post("/doctor", verifyJWT, verifyAdmin, async (req, res) => {
      const doctor = req.body;
      const result = await doctorCollection.insertOne(doctor);
      res.send(result);
    });

    app.delete("/doctor/:email", verifyJWT, verifyAdmin, async (req, res) => {
      const email = req.params.email;
      const filter = { email: email };
      const result = await doctorCollection.deleteOne(filter);
      res.send(result);
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

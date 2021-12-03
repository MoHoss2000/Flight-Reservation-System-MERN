const express = require("express");
const Flight = require("../models/flightSchema");
const User = require("../models/userSchema");
const Reservation = require("../models/reservationSchema");
const endOfDay = require("date-fns/endOfDay");
const startOfDay = require("date-fns/startOfDay");
const { parseISO, parse } = require("date-fns");
const { body, validationResult } = require("express-validator");
const sendMail = require("../helpers/sendMail");

const router = express.Router();

// edit profile
router.post("/update", async (req, res) => {
  console.log(req.body);
  User.findByIdAndUpdate(req.body._id, req.body, function (err, newUser) {
    if (err) {
      //duplicate key error
      if (err.code === 11000) {
        res.status(400).send("User does not exist");
        return;
      }

      return res.status(400).send(err.codeName);
    }

    res.status(200).send("User updated");
  });
});

// get user
router.get("/:id", async (req, res) => {
  console.log(req.params.id);
  User.findById(req.params.id, function (err, user) {
    if (!err) {
      res.status(200).send(user);
    } else {
      console.log(err);
      return res.status(400).send(err);
    }
  });
});
//get flight with flight ID
router.get("/flight/:id", async (req, res) => {
  try {
    var flight = await Flight.findById(req.params.id);
    res.status(200).send(flight)
    console.log(flight);
  } catch (err) {
    console.log(err);
    return res.status(400).send(err);
  }
});

//get reservation with reservation ID
router.get("/reservation/:id", async (req, res) => {
  try {
    var reservation = await Reservation.findById(req.params.id);
    res.status(200).send(reservation)
    console.log(reservation);
  } catch (err) {
    console.log(err);
    return res.status(400).send(err);
  }
});

router.get("/reservations/:id", async (req, res) => {
  Reservation.find({ userId: req.params.id }, function (err, reservations) {
    if (!err) {
      reservations.forEach(async (reservation) => {
        var departureFlight = await Flight.findById(
          reservation.departureFlightId
        );
        var returnFlight = await Flight.findById(reservation.returnFlightId);
        reservation._doc.departureFlight = departureFlight;
        reservation._doc.returnFlight = returnFlight;
        console.log(reservation);
      });
      //console.log(reservations);
      res.status(200).send(reservations);
    } else {
      console.log(err);
      return res.status(400).send(err);
    }
  });
});

// delete reservation
router.delete("/reservation/:id", async (req, res) => {
  try {
    var deletedRes = await Reservation.findByIdAndRemove(req.params.id);
    console.log(deletedRes);

    if (deletedRes == null)
      return res.status(400).send("No reservation with this id");

    var userID = deletedRes.userId;

    var user = await User.findById(userID);

    var userEmail = user.email;

    console.log(userEmail);

    console.log(
      await sendMail(
        userEmail,
        "Reservation cancelled",
        `Your reservation with booking number ${deletedRes._id} was cancelled recently.\nYou will be refunded with an amount of `
      )
    );

    res.status(200).send("succesfully deleted!");
  } catch (err) {
    res.status(400).send(err.message);
    console.log(err);
  }
});

// create reservation
router.post("/reservation/create", async (req, res) => {
  console.log(req.body);
  var {
    userId,
    departureFlightId,
    returnFlightId,
    chosenCabinDeparture,
    chosenCabinReturn,
    seatNumbersDeparture,
    seatNumbersReturn,
    adults,
    children,
  } = req.body;

  var noOfSeats = adults + children;

  if (
    noOfSeats != seatNumbersDeparture.length ||
    noOfSeats != seatNumbersReturn.length
  )
    return res
      .status(400)
      .send("Entered seat numbers do not match required seats");

  var departureFlight = await Flight.findById(departureFlightId);
  var returnFlight = await Flight.findById(returnFlightId);

  var freeSeatsDep = departureFlight.freeSeats;
  var freeSeatsReturn = returnFlight.freeSeats;

  freeSeatsDep = freeSeatsDep.filter(
    (element) => !seatNumbersDeparture.includes(element)
  );
  freeSeatsReturn = freeSeatsReturn.filter(
    (element) => !seatNumbersReturn.includes(element)
  );

  await Flight.findByIdAndUpdate(departureFlightId, {
    freeSeats: freeSeatsDep,
  });
  await Flight.findByIdAndUpdate(returnFlightId, {
    freeSeats: freeSeatsReturn,
  });
  if (chosenCabinDeparture == "economy") {
    var departurePrice =
      adults * departureFlight.economyPrice +
      0.5 * (children * departureFlight.economyPrice);
  } else {
    var departurePrice =
      adults * departureFlight.businessPrice +
      0.5 * (children * departureFlight.businessPrice);
  }
  if (chosenCabinReturn == "economy") {
    var returnPrice =
      adults * returnFlight.economyPrice +
      0.5 * (children * returnFlight.economyPrice);
  } else {
    var returnPrice =
      adults * returnFlight.businessPrice +
      0.5 * (children * returnFlight.businessPrice);
  }

  var price = departurePrice + returnPrice;

  const newReservation = new Reservation({ ...req.body, price });
  console.log(newReservation);
  try {
    await newReservation.save();
    res.status(200).send("Reservation added successfully");
  } catch (e) {
    if (e.code === 11000) {
      res.status(400).send("Reservation no already exists");
      return;
    }

    res.status(400).send(e.codeName);
  }
});

function checkFreeSeatsAvailable(cabin, flight, requiredSeats) {
  var freeBuisinessSeats = flight.freeSeats.filter((seat) => seat.startsWith('B'));
  var freeEconomySeats = flight.freeSeats.filter((seat) => seat.startsWith('E'));

  var seats = cabin == 'economy' ? freeEconomySeats : freeBuisinessSeats;

  if (seats.length >= requiredSeats)
    return true;

  return false;
}

// flight search
router.post("/flights/search", async (req, res) => {
  console.log(req.body);

  var {adults, children, departureAirport, arrivalAirport, cabinClass} = req.body;
  var depDate = parseISO(req.body.departureDate);
  var returnDate = parseISO(req.body.returnDate);

  var noOfRequiredSeats = parseInt(adults) + parseInt(children);

  var candidateDepFlights = await Flight.find({
    departureAirport: departureAirport,
    arrivalAirport: arrivalAirport,
    departureDate: {
      $gte: startOfDay(depDate),
      $lte: endOfDay(depDate),
    },
  });

  var candidateReturnFlights = await Flight.find({
    departureAirport: arrivalAirport,
    arrivalAirport: departureAirport,
    departureDate: {
      $gte: startOfDay(returnDate),
      $lte: endOfDay(returnDate),
    },
  });

  // console.log(candidateFlights);
  var departureFlights = [];
  var returnFlights = [];

  candidateDepFlights.forEach((flight) => {
    if (checkFreeSeatsAvailable(cabinClass, flight, noOfRequiredSeats))
      departureFlights.push(flight);

  });

  candidateReturnFlights.forEach((flight) => {
    if (checkFreeSeatsAvailable(cabinClass, flight, noOfRequiredSeats))
      returnFlights.push(flight);
  });

  if(returnFlights.length == 0 || departureFlights.length == 0)
    return res.status(400).send('No flights found matching your criteria');

  // console.log(result);
  res.status(200).send({
    departureFlights,
    returnFlights
  });

  // res.status(400).send(e.codeName);
});

module.exports = router;

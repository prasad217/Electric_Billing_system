require('dotenv').config();

const express = require('express');
const session = require('express-session');
const mysql = require('mysql');
const bcrypt = require('bcrypt');
const cors = require('cors');

const app = express();
const PORT = 3001;
const nodemailer = require('nodemailer');

app.use(cors({
    origin: 'http://localhost:3000',
}));

const db = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
});

db.connect(err => {
    if (err) {
        console.error('Failed to connect to MySQL:', err);
        return;
    }
    console.log('Connected to MySQL database');
    db.query('USE electricity_payment_system;', (err) => {
        if (err) throw err;
    });
});

app.use(session({
  secret: 'your-secret-key',
  resave: false,
  saveUninitialized: false,
}));

app.use(express.json());


const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER, 
    pass: process.env.EMAIL_PASSWORD 
  }
});

const sendBillEmail = (email, billDetails) => {
  const mailOptions = {
    from: 'your_email@gmail.com',
    to: email,
    subject: 'Your Electricity Bill',
    text: `Dear customer,\n\nYour electricity bill details:\n\nWatts Used: ${billDetails.wattsUsed}\nBill Amount: ${billDetails.billAmount}\nBill Generated Date: ${billDetails.billGeneratedDate}\nBill Deadline Date: ${billDetails.billDeadlineDate}\n\nThank you for using our service.`,
  };

  transporter.sendMail(mailOptions, function (error, info) {
    if (error) {
      console.error('Email sending failed:', error);
    } else {
      console.log('Email sent:', info.response);
    }
  });
};


app.post('/user/register', async (req, res) => {
    const { name, address, phone_number, electricity_board_number, email, password } = req.body;
    
    if (!name || !address || !phone_number || !electricity_board_number || !email || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }
  
    try {
      const hashedPassword = await bcrypt.hash(password, 10);
      const sql = 'INSERT INTO users (name, address, PhoneNumber, electricityBoardNumber, email, password) VALUES (?, ?, ?, ?, ?, ?)';
      db.query(sql, [name, address, phone_number, electricity_board_number, email, hashedPassword], (err, result) => {
        if (err) {
          console.error('Database error:', err);
          return res.status(500).json({ error: 'Internal Server Error' });
        }
        res.status(201).json({ message: 'User registered successfully.' });
      });
    } catch (error) {
      console.error('Error:', error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });
  

app.post('/admin/register', async (req, res) => {
  try {
    const adminData = req.body;
    const hashedPassword = await bcrypt.hash(adminData.password, 10);
    const sql = 'INSERT INTO administrators SET ?';
    db.query(sql, { ...adminData, password: hashedPassword }, (err, result) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: 'Internal Server Error' });
      }
      req.session.role = 'admin';
      req.session.email = adminData.email;
      res.status(201).json({ message: 'Administrator registered successfully.' });
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});
app.post('/user/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const sql = 'SELECT * FROM users WHERE email = ?';
    db.query(sql, [email], async (err, result) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: 'Internal Server Error' });
      }
      if (result.length === 0 || !(await bcrypt.compare(password, result[0].password))) {
        return res.status(401).json({ error: 'Invalid email or password.' });
      }
      // Sending userId as part of the response
      const userId = result[0].id; // Assuming the identifier column in your database is 'id'
      res.json({ message: 'Login successful!', userId });
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});


app.post('/admin/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const sql = 'SELECT * FROM administrators WHERE email = ?';
    db.query(sql, [email], async (err, result) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: 'Internal Server Error' });
      }
      if (result.length === 0 || !(await bcrypt.compare(password, result[0].password))) {
        return res.status(401).json({ error: 'Invalid email or password.' });
      }
      req.session.role = 'admin';
      req.session.email = email;
      res.json({ message: 'Login successful!' });
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});


app.get('/admin/users', async (req, res) => {
    const sql = 'SELECT * FROM users';  // Ensure your table name and structure match this query
    db.query(sql, (err, results) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Internal Server Error' });
      }
      res.json(results);
    });
  });
  app.post('/admin/generate-bill', async (req, res) => {
    const { userId, wattsUsed } = req.body;
    const costPerWatt = 15; // cost per watt
    const billAmount = wattsUsed * costPerWatt;
    const billGeneratedDate = new Date();
    const billDeadlineDate = new Date(billGeneratedDate);
    billDeadlineDate.setDate(billGeneratedDate.getDate() + 18); // Deadline is 18 days from now

    // Check if userId is provided and is a valid number
    if (!userId || isNaN(userId)) {
        return res.status(400).json({ error: 'Invalid userId' });
    }

    try {
        // Check if the user with the provided userId exists
        const userQuery = 'SELECT * FROM users WHERE id = ?';
        db.query(userQuery, [userId], async (err, userResults) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ error: 'Internal Server Error' });
            }
            if (userResults.length === 0) {
                return res.status(404).json({ error: 'User not found' });
            }

            const electricityBoardNumber = userResults[0].electricityBoardNumber;

            // Insert bill data into the database including the electricityBoardNumber
            const sql = 'INSERT INTO bills (user_id, electricityBoardNumber, watts_used, bill_amount, bill_generated_date, bill_deadline_date) VALUES (?, ?, ?, ?, ?, ?)';
            db.query(sql, [userId, electricityBoardNumber, wattsUsed, billAmount, billGeneratedDate, billDeadlineDate], (err, result) => {
                if (err) {
                    console.error('Database error:', err);
                    return res.status(500).json({ error: 'Internal Server Error' });
                }
                res.json({
                    message: 'Bill generated successfully.',
                    bill: {
                        userId,
                        electricityBoardNumber,
                        wattsUsed,
                        billAmount,
                        billGeneratedDate,
                        billDeadlineDate
                    }
                });

                // Send bill email to the user
                sendBillEmail(userResults[0].email, {
                  wattsUsed,
                  billAmount,
                  billGeneratedDate,
                  billDeadlineDate
                });
            });
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// Backend route
app.get('/user/:userId/bill', async (req, res) => {
  const { userId } = req.params;

  // Check if userId is provided and is a valid number
  if (!userId || isNaN(userId)) {
    return res.status(400).json({ error: 'Invalid userId' });
  }

  const sql = 'SELECT * FROM bills WHERE user_id = ? ORDER BY bill_generated_date DESC LIMIT 1';
  db.query(sql, [userId], (err, results) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
    if (results.length > 0) {
      res.json(results[0]);
    } else {
      res.status(404).json({ message: 'No bill found for this user' });
    }
  });
});
app.post('/user/pay', async (req, res) => {
  const { userId } = req.body;
  try {
    // Update the payment status in the database
    const sql = 'UPDATE bills SET payment_status = "paid" WHERE user_id = ?';
    db.query(sql, [userId], (err, result) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Internal Server Error' });
      }
      res.json({ message: 'Payment successful.' });
    });
  } catch (error) {
    console.error('Error processing payment:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});


app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

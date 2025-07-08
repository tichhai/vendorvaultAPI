const express = require("express");
const dotenv = require("dotenv");
const cors = require('cors');
const multer = require("multer");
const Stripe = require('stripe');
const stripe = Stripe('sk_test_51QOMaiAYbJERaZO4HNhTsVrSBk9jNysXmfEuEY9yumBqs90RR5ftEUnxOrT2gg0o8qKIk8zz4si4GsxxvP57Rvia00jQTjdRRN'); // Thay bằng secret key Stripe của bạn

const adminUserRoutes = require("./routes/adminUserRoutes");
const memberRoutes = require("./routes/memberRoutes");
const orderRoutes = require("./routes/orderRoutes");
const goodsRoutes = require("./routes/goodsRoutes");
const storeRoutes = require("./routes/storeRoutes");
const goodsStoreRoutes = require("./routes/goodsStoreRoutes");
const orderStoreRoutes = require("./routes/orderStoreRoutes");
const memberStoreRoutes = require("./routes/memberStoreRoutes");
const buyerStoreRoutes = require("./routes/buyerStoreRoutes");
const storeLoginRoutes = require("./routes/storeLoginRoutes");
const storeSettingRoutes = require("./routes/storeSettingRoutes");
const storeStatisticsRoutes = require("./routes/storeStatisticsRoutes");
const uploadRouter = require('./upload/upload');
dotenv.config();
const app = express();
// app.use(cors({
//   origin: 'http://localhost:10003',
//   credentials: true
// }));

app.use(cors());

app.use((req, res, next) => {
  const originalJson = res.json;
  res.json = function (data) {
    const serializedData = JSON.parse(
      JSON.stringify(data, (key, value) =>
        typeof value === "bigint" ? value.toString() : value
      )
    );
    return originalJson.call(this, serializedData);
  };
  next();
});
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.post('/api/create-stripe-session', async (req, res) => {
  const { items } = req.body;
 
  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      locale: 'en',
      line_items: items.map(item => ({
        price_data: {
          currency: item.currency || 'usd',
          product_data: {
            name: item.name,
            images: item.image ? [item.image] : [],
          },
          unit_amount: item.amount, // đơn vị cent
        },
        quantity: item.quantity,
      })),
      mode: 'payment',
      success_url: 'http://localhost:10000/paydone', 
      cancel_url: 'http://localhost:10000/cart',    
    });
    res.json({ sessionId: session.id });
  } catch (err) {
    console.error('Stripe session creation error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/create-stripe-session-store', async (req, res) => {
  const { userId, amount } = req.body;
  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'VendorVault Payment',
              metadata: { userId }
            },
            unit_amount: amount * 100, 
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: 'http://localhost:10002/login',
      cancel_url: 'http://localhost:10002/home',
      metadata: { userId }
    });
    res.json({ sessionId: session.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.use(uploadRouter);
app.use("/manager/passport/user", adminUserRoutes);
app.use("/manager/passport", memberRoutes);
app.use("/manager/passport/order", orderRoutes);
app.use("/manager/passport/goods", goodsRoutes);
app.use("/manager/passport/goods", goodsRoutes);
app.use("/manager/passport/store", storeRoutes);
app.use("/store/goods", goodsStoreRoutes);
app.use("/store/order", orderStoreRoutes);
app.use("/store/member", memberStoreRoutes);
app.use("/store/passport", storeLoginRoutes);
app.use("/store/settings", storeSettingRoutes);
app.use("/store/statistics", storeStatisticsRoutes);
app.use("/buyer", buyerStoreRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

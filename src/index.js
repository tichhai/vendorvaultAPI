const express = require("express");
const dotenv = require("dotenv");
const cors = require('cors');
const multer = require("multer");
const adminUserRoutes = require("./routes/adminUserRoutes");
const memberRoutes = require("./routes/memberRoutes");
const orderRoutes = require("./routes/orderRoutes");
const goodsRoutes = require("./routes/goodsRoutes");
const storeRoutes = require("./routes/storeRoutes");
const goodsStoreRoutes = require("./routes/goodsStoreRoutes");
const orderStoreRoutes = require("./routes/orderStoreRoutes");
const memberStoreRoutes = require("./routes/memberStoreRoutes");
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

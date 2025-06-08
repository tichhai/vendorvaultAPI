const express = require("express");
const router = express.Router();
const camelcaseKeys = require('camelcase-keys').default;
const { PrismaClient } = require("@prisma/client");
const jwt = require("jsonwebtoken");
const multer = require('multer');
const upload = multer();
const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key";
const JWT_REFRESH_SECRET =
  process.env.JWT_REFRESH_SECRET || "your-refresh-secret-key";
function resultData(data) {
  return {
    success: true,
    message: "success",
    code: 200,
    result: data,
  };
}
function resultSuccessMsg(msg, code = 200) {
  return {
    success: true,
    message: msg,
    code,
  };
}
function resultErrorMsg(msg, code = 500) {
  return {
    success: false,
    message: msg,
    code,
  };
}

// Middleware giải mã JWT và lấy user info
async function authMiddleware(req, res, next) {
  const token = req.header("accessToken");
  if (!token) {
    return res.status(401).json(resultErrorMsg("No accessToken", 401));
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.tokenUser = decoded;
    next();
  } catch (err) {
    return res
      .status(401)
      .json(resultErrorMsg("The token is invalid or expired.", 401));
  }
}

// GET /manager/passport/user/info
router.get("/info", authMiddleware, async (req, res) => {
  const tokenUser = req.tokenUser;
  if (!tokenUser || !tokenUser.username) {
    return res.status(401).json(resultErrorMsg("No token", 401));
  }
  // Tìm user theo username
  const adminUser = await prisma.admin_user.findUnique({
    where: { username: tokenUser.username },
  });
  if (!adminUser) {
    return res.status(401).json(resultErrorMsg("User not found", 401));
  }
  // Ẩn password
  const userInfo = {
    ...adminUser,
    password: null,
  };
  const camelCaseResult = camelcaseKeys(userInfo, { deep: true });
  return res.json(resultData(camelCaseResult));
});

// Sử dụng upload.none() để parse form-data cho route login
router.post("/login", upload.none(), async (req, res) => {
  let username = req.body?.username
  let password = req.body?.password 
  if (!username)
    return res
      .status(400)
      .json(resultErrorMsg("Username cannot be empty", 400));
  if (!password)
    return res
      .status(400)
      .json(resultErrorMsg("Password cannot be empty", 400));
  try {
    const user = await prisma.admin_user.findUnique({ where: { username } });
    if (!user || user.password !== password) {
      return res
        .status(401)
        .json(resultErrorMsg("Wrong username or password", 401));
    }
    const payload = {
      id: Number(user.id), // ép BigInt -> Number
      username: user.username,
    };
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: "1h" });
    const refreshToken = jwt.sign(payload, JWT_REFRESH_SECRET, {
      expiresIn: "7d",
    });
    return res.json(resultData({ accessToken: token, refreshToken }));
  } catch (err) {
    console.error("Login error:", err);
    return res.status(500).json(resultErrorMsg("Internal server error", 500));
  }
});

// xác thực refreshToken, giải mã, tạo accessToken mới
async function refreshTokenService(refreshToken) {
    if (!refreshToken) {
        throw new Error('Refresh token cannot be empty');
    }
    let payload;
    try {
        payload = jwt.verify(refreshToken, JWT_REFRESH_SECRET);
    } catch (err) {
        throw new Error('Invalid or expired refreshToken');
    }
    const user = await prisma.admin_user.findUnique({ where: { username: payload.username } });
    if (!user) {
        throw new Error('User not found');
    }
    
    const newAccessToken = jwt.sign({ id: Number(user.id), username: user.username }, JWT_SECRET, { expiresIn: '1h' });
    const newRefreshToken = jwt.sign({ id: Number(user.id), username: user.username }, JWT_REFRESH_SECRET, { expiresIn: '7d' });
    return { accessToken: newAccessToken, refreshToken: newRefreshToken };
}

router.get('/refresh/:refreshToken', async (req, res) => {
    try {
        const { refreshToken } = req.params;
        const data = await refreshTokenService(refreshToken);
        res.json(resultData(data));
    } catch (err) {
        res.json({
            code: 400,
            message: err.message,
            data: null
        });
    }
});

// POST /manager/passport/user/logout
router.post('/logout', async (req, res) => {
  const token = req.header('accessToken');
  if (!token) {
    return res.status(401).json(resultErrorMsg('No accessToken', 401));
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    res.json(resultSuccessMsg('Logout successful', 200));
  } catch (err) {
    return res.status(401).json(resultErrorMsg('The token is invalid or expired.', 401));
  }
});

module.exports = router;

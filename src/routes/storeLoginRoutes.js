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
    req.storeId = decoded.storeId; 
    next();
  } catch (err) {
    return res
      .status(401)
      .json(resultErrorMsg("The token is invalid or expired.", 401));
  }
}

// GET /store/passport/login/userLogin
router.get("/login/userLogin", authMiddleware, async (req, res) => {
  const tokenUser = req.tokenUser;
  if (!tokenUser || !tokenUser.username) {
    return res.status(401).json(resultErrorMsg("No token", 401));
  }
  // Tìm user theo username
  const adminUser = await prisma.user.findUnique({
    where: { username: tokenUser.username,disabled: false },
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
// GET /store/passport/login/userLogin
router.post("/login/userLogin", upload.none(), async (req, res) => {
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
    const user = await prisma.user.findUnique({ where: { username,disabled:false },include: { store: true } });
    if (!user || user.password !== password) {
      return res
        .status(401)
        .json(resultErrorMsg("Wrong username or password", 401));
    }
    const payload = {
      id: Number(user.id), // ép BigInt -> Number
      username: user.username,
      storeId: Number(user.store.id), 
      paymentDueDate: user.store.payment_due_date || null,
    };
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: "1d" });
    const refreshToken = jwt.sign(payload, JWT_REFRESH_SECRET, {
      expiresIn: "7d",
    });
    return res.json(resultData({ accessToken: token, refreshToken,storeLogo: user.store[0]?.store_logo || null }));
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
    const user = await prisma.user.findUnique({ where: { username: payload.username} });
    if (!user) {
        throw new Error('User not found');
    }
    
    const newAccessToken = jwt.sign({ id: Number(user.id), username: user.username }, JWT_SECRET, { expiresIn: '1d' });
    const newRefreshToken = jwt.sign({ id: Number(user.id), username: user.username }, JWT_REFRESH_SECRET, { expiresIn: '7d' });
    return { accessToken: newAccessToken, refreshToken: newRefreshToken };
}

router.get('/login/refresh/:refreshToken', async (req, res) => {
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

// POST /store/passport/login/logout
router.post('/login/logout', async (req, res) => {
  const token = req.header('accessToken');
  if (!token) {
    return res.status(401).json(resultErrorMsg('No accessToken', 401));
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    res.json(resultSuccessMsg())
  } catch (err) {
    return res.status(401).json(resultErrorMsg('The token is invalid or expired.', 401));
  }
});

// POST /store/passport/login/modifyPass
router.post('/login/modifyPass',authMiddleware, async (req, res) => {
  const { password, newPassword } = req.body; 
  const username = req.tokenUser.username;

  if (!username) {
    return res.status(401).json({ code: 401, message: 'No username', data: null });
  }
  if (!password || !newPassword) {
    return res.status(400).json({ code: 400, message: 'No Password Data', data: null });
  }

  try {
    const member = await prisma.user.findUnique({ where: { username} });
    if (!member) {
      return res.status(404).json({ code: 404, message: 'User doesnt exist!', data: null });
    }

    // Kiểm tra mật khẩu cũ
    const match = password === member.password; 
    if (!match) {
      return res.status(400).json({ code: 400, message: 'Password do no not match', data: null });
    }

    const updatedMember = await prisma.user.update({
      where: { username },
      data: { password: newPassword }
    });

    res.json(resultData());
  } catch (error) {
    res.status(500).json({ code: 500, message: error.message, data: null });
  }
});

module.exports = router;

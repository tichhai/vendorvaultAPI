const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const camelcaseKeys = require('camelcase-keys').default;
const snakecaseKeys = require('snakecase-keys');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
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

function resultSuccess() {
  return {
    success: true,
    code: 200, 
    message: 'success',
    data: null
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
  const token = req.headers.accesstoken;
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

// GET /buyer/store/store/apply
router.get('/store/store/apply',authMiddleware, async (req, res) => {
  if(!req.tokenUser) {
    return res.status(400).json({ code: 400, message: 'No tokenUser', data: null });
  }
  try {
    if(req.tokenUser.storeId) {
      const storeDetail = await prisma.store.findUnique({
      where: { id: req.tokenUser.storeId },
      });
      const result = camelcaseKeys(storeDetail, { deep: true });
      res.json(resultData(result));
    }
  } catch (e) {
    console.error('Error fetching store details:', e);
    res.json({ code: 500, message: 'Internal server error', data: null });
  }
});

// put /buyer/store/store/apply/first
router.put('/store/store/apply/first',authMiddleware, async (req, res) => {
  const userId = req.tokenUser.id;
  try {
    const {companyEmail,companyPhone} = req.query;
    // Tính payment_due_date = ngày hiện tại + 1 tháng
    const now = new Date();
    const paymentDueDate = new Date(now.setMonth(now.getMonth() + 1));
    const newStore = await prisma.store.create({
      data: {
        email: companyEmail,
        mobile: companyPhone,
        payment_due_date: paymentDueDate,
      }
    });
    await prisma.user.update({ 
      where: { id: userId },
      data: { store: { connect: { id: newStore.id } },role: 'SELLER' }
    });
    res.json(resultSuccess());
  } catch (error) {
    console.error('Error applying for store:', error);
    res.status(500).json({ code: 500, message: error.message, data: null });
  }
});

// PUT /buyer/store/store/apply/third
router.put('/store/store/apply/third',authMiddleware, async (req, res) => {
  try {
    const userId = req.tokenUser.id;
    const {storeAddressDetail,storeDesc,storeLogo,storeName} = req.query;
    // Tìm store theo user_id trước
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { store: true }
    });
    const store = await prisma.store.findFirst({ where: { id: user.store.id } });
    if (!store) {
      return res.status(404).json({ code: 404, message: 'Store not found', data: null });
    }
    await prisma.store.update({
      where: { id: store.id },
      data: {
        store_address_detail: storeAddressDetail,
        store_desc: storeDesc,
        store_logo: storeLogo,
        store_name: storeName,
        store_disable: "APPLYING"
      }
    });
    res.json(resultSuccess());
  } catch (error) {
    console.error('Error updating store info:', error);
    res.status(500).json({ code: 500, message: error.message, data: null });
  }
});

// POST /buyer/passport/member/register
router.post('/passport/member/register', async (req, res) => {
  const { username, password, mobilePhone,email } = req.body || req.query;
  if (!username || !password || !mobilePhone) {
    return res.status(400).json({ code: 400, message: 'No Info', data: null });
  }

  try {
    const existUser = await prisma.user.findFirst({
      where: {
        OR: [
          { username: username },
          { mobile: mobilePhone }
        ]
      }
    });
    if (existUser) {
      return res.status(400).json({ code: 400, message: 'User exist!', data: null });
    }

    const newUser = await prisma.user.create({
      data: {
        username,
        password: password,
        mobile: mobilePhone,
        email
      }
    });

    res.json(resultData());
  } catch (error) {
    res.status(500).json({ code: 500, message: error.message, data: null });
  }
});

// POST /buyer/passport/member/logout
router.post('/passport/member/logout', async (req, res) => {
  const token = req.header('accessToken');
  if (!token) {
    return res.status(401).json(resultErrorMsg('No accessToken', 401));
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    res.json(resultSuccess('Logout successfully', 200));
  } catch (err) {
    return res.status(401).json(resultErrorMsg('The token is invalid or expired.', 401));
  }
});

// POST /buyer/passport/member/userLogin
router.post('/passport/member/userLogin', async (req, res) => {
  const { username, password } = req.body || req.query  ;
  if (!username || !password) {
    return res.status(400).json({ code: 400, message: 'No Info', data: null });
  }

  try {
    const member = await prisma.user.findUnique({ where: { username } });
    if (!member) {
      return res.status(400).json({ code: 400, message: 'No user', data: null });
    }

    const match = password === member.password; 
    if (!match) {
      return res.status(400).json({ code: 400, message: 'Password is incorrect!', data: null });
    }

    const payload = {
      id: Number(member.id), // ép BigInt -> Number
      username: member.username,
      storeId: member.store_id ? Number(member.store_id) : null 
    };
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: "1d" });
    const refreshToken = jwt.sign(payload, JWT_REFRESH_SECRET, {
      expiresIn: "7d",
    });
    return res.json(resultData({ accessToken: token, refreshToken }));
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ code: 500, message: error.message, data: null });
  }
});

// GET /buyer/passport/member
router.get('/passport/member',authMiddleware, async (req, res) => {
  const userId = req.tokenUser.id; 
  if (!userId) {
    return res.status(401).json({ code: 401, message: 'No User ID', data: null });
  }

  try {
    const member = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!member) {
      return res.status(404).json({ code: 404, message: 'User Not Found', data: null });
    }
    const resultC = camelcaseKeys(member, { deep: true });
    res.json(resultData(resultC));
  } catch (error) {
    console.error('Error fetching user info:', error);
    res.status(500).json({ code: 500, message: error.message, data: null });
  }
});

// POST /buyer/passport/member/resetPassword
router.post('/passport/member/resetPassword',authMiddleware, async (req, res) => {
  const { password } =req.body ||  req.query ;

  if (!password) {
    return res.status(400).json({ code: 400, message: 'No Password', data: null });
  }

  try {
    const userID = req.tokenUser.id;
    if (!userID) {
      return res.status(404).json({ code: 404, message: 'No UserID', data: null });
    }

    await prisma.user.update({
      where: { id:userID },
      data: { password: password }
    });

    res.json(resultData());
  } catch (error) {
    res.status(500).json({ code: 500, message: error.message, data: null });
  }
});

// GET /buyer/goods/goods/es
router.get('/goods/goods/es', async (req, res) => {
  const { categoryId, keyword, sort, prop, order, storeId } = req.query;
  const page = Number(req.query.pageNumber) || 1;
  const size = Number(req.query.pageSize) || 10;
  let where = {
    market_enable: "UPPER",
    store: {
      payment_due_date: {
        gt: new Date()
      }
    }
  };
  if (storeId && storeId !== '') {
    where.store_id = BigInt(storeId);
  }
  if (categoryId && categoryId !== '') {
    where.category_id = categoryId;
  }
  if (keyword) {
    where.goods_name = { contains: keyword };
  }
  // Xử lý lọc theo prop (brand name)
  if (prop) {
    // prop có dạng: Brand_Brand 1@Brand_Brand 2
    const brandNames = prop.split('@')
      .filter(p => p.startsWith('Brand_'))
      .map(p => p.replace('Brand_', '').trim())
      .filter(Boolean);
    if (brandNames.length > 0) {
      // Lấy id các brand theo tên
      const brandsInDb = await prisma.brand.findMany({ where: { name: { in: brandNames } } });
      const brandIdsFromProp = brandsInDb.map(b => b.id);
      if (brandIdsFromProp.length > 0) {
        where.brand_id = { in: brandIdsFromProp };
      } else {
        // Nếu không có brand nào khớp, trả về rỗng
        where.brand_id = -1;
      }
    }
  }
  try {
    let orderBy = { id: 'desc' };
    if (sort) {
      if (sort === 'commentNum') {
        orderBy = { comment_num: 'desc' };
      } else if (sort === 'createTime') {
        orderBy = { create_time: 'desc' };
      } else if (sort === 'price' && order && order === 'asc') {
        orderBy = { price: 'asc' };
      } else if (sort === 'price' && order && order === 'desc') {
        orderBy = { price: 'desc' };
      }
    }

    const [records, total] = await Promise.all([
      prisma.goods.findMany({
        where: where,
        skip: (page - 1) * size,
        take: size,
        orderBy: orderBy,
        include: {
          goods_gallery: {
            take: 1,
            orderBy: { sort: 'asc' }
          },
          store: {
            select: { store_name: true, payment_due_date: true }
          },
          goods_sku: {
            take: 1,
            orderBy: { id: 'asc' }, 
            select: { id: true }
          }
        }
      }),
      prisma.goods.count({ where })
    ]);

    const goodsIds = records.map(good => good.id);
    // Get comment count for each goods id
    const commentCounts = await prisma.user_evaluation.groupBy({
      by: ['goods_id'],
      where: { goods_id: { in: goodsIds } },
      _count: { id: true }
    });
    const commentCountMap = {};
    commentCounts.forEach(item => {
      commentCountMap[item.goods_id] = item._count.id;
    });

    // Get all SKUs for the listed goods
    const skus = await prisma.goods_sku.findMany({
      where: { goods_id: { in: goodsIds } },
      orderBy: { id: 'asc' },
      select: { id: true, goods_id: true }
    });
    const skuMap = {};
    skus.forEach(sku => {
      if (!skuMap[sku.goods_id]) {
        skuMap[sku.goods_id] = sku.id; // first/default skuId for each good
      }
    });

    // add thumbnail, commentNum (from user_evaluation), storeName, skuId
    const mappedRecords = records.map(good => {
      const thumbnail = good.goods_gallery && good.goods_gallery.length > 0 ? good.goods_gallery[0].original || good.goods_gallery[0].small : null;
      return {
        ...good,
        thumbnail,
        comment_num: commentCountMap[good.id] || 0,
        store_name: good.store ? good.store.store_name : null,
        price: good.price && typeof good.price.toNumber === 'function' ? good.price.toNumber() : good.price,
        skuId: skuMap[good.id] || null
      };
    });

    const result = {
      records: mappedRecords,
      total,
      size,
      current: page,
      pages: Math.ceil(total / size)
    };
    const camelCaseResult = camelcaseKeys(result, { deep: true });
    res.json(resultData(camelCaseResult));
  } catch (error) {
    console.error('Error fetching goods:', error);
    res.status(500).json({ code: 500, message: error.message, data: null });
  }
});

// GET /buyer/goods/goods/es/related
router.get('/goods/goods/es/related', async (req, res) => {
  const { brandId, categoryId, keyword,sort,prop } = req.query;
  try {
    let goodsWhere = {};
    if (brandId) goodsWhere.brand_id = Number(brandId);
    if (categoryId) goodsWhere.category_id = Number(categoryId);
    if (keyword) goodsWhere.goods_name = { contains: keyword };

    // Xử lý lọc theo prop (brand name)
    if (prop) {
      // prop có dạng: Brand_Brand 1@Brand_Brand 2
      const brandNames = prop.split('@')
        .filter(p => p.startsWith('Brand_'))
        .map(p => p.replace('Brand_', '').trim())
        .filter(Boolean);
      if (brandNames.length > 0) {
        // Lấy id các brand theo tên
        const brandsInDb = await prisma.brand.findMany({ where: { name: { in: brandNames } } });
        const brandIdsFromProp = brandsInDb.map(b => b.id);
        if (brandIdsFromProp.length > 0) {
          goodsWhere.brand_id = { in: brandIdsFromProp };
        } else {
          // Nếu không có brand nào khớp, trả về rỗng
          goodsWhere.brand_id = -1;
        }
      }
    }

    const goods = await prisma.goods.findMany({
      where: goodsWhere,
      include: {
        goods_gallery: { take: 1, orderBy: { sort: 'asc' } },
        brand: true,
        goods_sku: true
      }
    });
    // brands: nếu có categoryId thì chỉ lấy các brand thuộc category đó
    let brandsRaw;
    if (categoryId) {
      // Lấy các brand_id thuộc category này từ bảng category_brand
      const categoryBrands = await prisma.category_brand.findMany({ where: { category_id: Number(categoryId) } });
      const brandIdsInCategory = categoryBrands.map(cb => cb.brand_id).filter(Boolean);
      brandsRaw = await prisma.brand.findMany({ where: { id: { in: brandIdsInCategory } }, orderBy: { id: 'asc' } });
    } else {
      brandsRaw = await prisma.brand.findMany({ orderBy: { id: 'asc' } });
    }
    const brands = brandsRaw.map(brand => ({
      name: brand.name,
      value: brand.id ? String(brand.id) : null,
      url: brand.logo || null
    }));

    // Lấy tất cả spec_value_ids từ các sku
    const allSpecValueIds = Array.from(new Set(goods.flatMap(g => g.goods_sku.flatMap(sku => (sku.spec_value_ids ? sku.spec_value_ids.split(',').filter(x => x && x !== 'null') : [])))));
    // Lấy thông tin spec_values và specification liên quan
    let specValueMap = {};
    if (allSpecValueIds.length > 0) {
      const specValues = await prisma.spec_values.findMany({
        where: { id: { in: allSpecValueIds.map(id => BigInt(id)) } },
        include: { specification: true }
      });
      specValueMap = Object.fromEntries(specValues.map(v => [v.id.toString(), v]));
      specIdToName = Object.fromEntries(specValues.map(v => [v.id.toString(), v.specification?.spec_name]));
    }

    // goodsList
    const goodsList = goods.map(good => {
      let props = {};
      if (good.goods_sku && good.goods_sku[0] && good.goods_sku[0].spec_value_ids) {
        const specValueIds = (good.goods_sku[0].spec_value_ids || '').split(',').filter(x => x && x !== 'null');
        props = Object.fromEntries(specValueIds.map(id => {
          const v = specValueMap[id];
          return v && v.specification ? [v.specification.spec_name, v.spec_value] : [id, null];
        }));
      }
      return {
        id: String(good.id),
        name: good.goods_name,
        price: good.price && typeof good.price.toNumber === 'function' ? good.price.toNumber() : Number(good.price) || 0,
        image: good.goods_gallery && good.goods_gallery.length > 0 ? good.goods_gallery[0].original : null,
        brandId: good.brand_id ? String(good.brand_id) : null,
        props
      };
    });

    const result = {
      brands,
      goodsList
    };
    res.json({
      success: true,
      result
    });
  } catch (error) {
    res.status(500).json({ code: 500, message: error.message, data: null });
  }
});

// POST /buyer/member/collection/add/GOODS/:id
router.post('/member/collection/add/GOODS/:id',authMiddleware, async (req, res) => {
  console.log('Adding goods collection',req.params.id);
  const { id } = req.params;
  const userId = req.tokenUser.id; 
  if (!id) {
    return res.status(400).json({ code: 400, message: 'No ID', data: null });
  }
  if (!userId) {
    return res.status(401).json({ code: 401, message: 'No user ID', data: null });
  }

  try {
    const exist = await prisma.goods_collection.findFirst({
      where: { user_id: userId, sku_id: id }
    });
    if (exist) {
      return res.json(resultData(true, 'Added to collection already'));
    }

    const collection = await prisma.goods_collection.create({
      data: {
        user_id: userId,
        sku_id: id,
        create_time: new Date()
      }
    });
    res.json(resultData());
  } catch (error) {
    console.error('Error adding goods collection:', error);
    res.status(500).json({ code: 500, message: error.message, data: null });
  }
});

// GET /buyer/member/collection/isCollection/GOODS/:id
router.get('/member/collection/isCollection/GOODS/:id',authMiddleware, async (req, res) => {
  const { id } = req.params;
  const userId = req.tokenUser.id; 

  if (!id) {
    return res.status(400).json({ code: 400, message: 'No SKU ID', data: null });
  }
  if (!userId) {
    return res.status(401).json({ code: 401, message: 'No user ID', data: null });
  }

  try {
    const exist = await prisma.goods_collection.findFirst({
      where: { user_id: userId, sku_id: id }
    });
    res.json(resultData(!!exist));
  } catch (error) {
    res.status(500).json({ code: 500, message: error.message, data: null });
  }
});

// DELETE /buyer/member/collection/delete/GOODS/:id
router.delete('/member/collection/delete/GOODS/:id',authMiddleware, async (req, res) => {
  const { id } = req.params;
  const userId = req.tokenUser.id; 
  if (!id) {
    return res.status(400).json({ code: 400, message: 'No ID', data: null });
  }
  if (!userId) {
    return res.status(401).json({ code: 401, message: 'No user ID', data: null });
  }

  try {
    await prisma.goods_collection.deleteMany({
      where: { user_id: userId, sku_id: id }
    });

    res.json(resultData());
  } catch (error) {
    console.error('Error deleting goods collection:', error);
    res.status(500).json({ code: 500, message: error.message, data: null });
  }
});

// DELETE /buyer/member/collection/delete/STORE/:id
router.delete('/member/collection/delete/STORE/:id',authMiddleware, async (req, res) => {
  const { id } = req.params;
  const userId = req.tokenUser.id; 
  if (!id) {
    return res.status(400).json({ code: 400, message: 'No ID', data: null });
  }
  if (!userId) {
    return res.status(401).json({ code: 401, message: 'No user ID', data: null });
  }

  try {
    await prisma.store_collection.delete({
      where: { user_id: userId, store_id: id }
    });

    res.json(resultData());
  } catch (error) {
    res.status(500).json({ code: 500, message: error.message, data: null });
  }
});

// GET /buyer/member/evaluation/:goodsId/goodsEvaluation
router.get('/member/evaluation/:goodsId/goodsEvaluation', async (req, res) => {
  const { goodsId } = req.params;
  const { pageNumber = 1, pageSize = 10, grade } = req.query;

  if (!goodsId) {
    return res.status(400).json({ code: 400, message: 'No GOODS ID', data: null });
  }

  try {
    const where = {
      goods_id: goodsId,
      status: 'OPEN', 
      grade: grade ? grade : undefined
    };

    const [records, total] = await Promise.all([
      prisma.user_evaluation.findMany({
        where,
        skip: (Number(pageNumber) - 1) * Number(pageSize),
        take: Number(pageSize),
        orderBy: { create_time: 'desc' },
        include: {
          user: { select: { face: true, username: true } },
          goods: { select: { goods_name: true } }
        }
      }),
      prisma.user_evaluation.count({ where })
    ]);

    // Map to add face, username, goodsName
    const mappedRecords = records.map(record => ({
      ...record,
      face: record.user ? record.user.face : null,
      username: record.user ? record.user.username : null,
      goodsName: record.goods ? record.goods.goods_name : null
    }));

    const result = {
      records: mappedRecords,
      total,
      size: Number(pageSize),
      current: Number(pageNumber),
      pages: Math.ceil(total / pageSize)
    };
    const camelCaseResult = camelcaseKeys(result, { deep: true });
    res.json(resultData(camelCaseResult));
  } catch (error) {
    console.error('Error fetching goods evaluation:', error);
    res.status(500).json({ code: 500, message: error.message, data: null });
  }
});

// GET /buyer/member/evaluation/:goodsId/evaluationNumber
router.get('/member/evaluation/:goodsId/evaluationNumber', async (req, res) => {
  const { goodsId } = req.params;
  if (!goodsId) {
    return res.status(400).json({ code: 400, message: 'No GOODS ID', data: null });
  }

  try {
    const [total, good, moderate, bad] = await Promise.all([
      prisma.user_evaluation.count({ where: { goods_id: goodsId, status: 'OPEN' } }),
      prisma.user_evaluation.count({ where: { goods_id: goodsId, status: 'OPEN', grade: 'GOOD' } }),
      prisma.user_evaluation.count({ where: { goods_id: goodsId, status: 'OPEN', grade: 'MODERATE' } }),
      prisma.user_evaluation.count({ where: { goods_id: goodsId, status: 'OPEN', grade: 'BAD' } })
    ]);

    const evaluationNumberVO = { all:total, good, moderate, worse:bad };
    res.json(resultData(evaluationNumberVO));
  } catch (error) {
    console.error('Error fetching evaluation numbers:', error);
    res.status(500).json({ code: 500, message: error.message, data: null });
  }
});

// GET /buyer/goods/goods/sku/:goodsId/:skuId
router.get('/goods/goods/sku/:goodsId/:skuId', async (req, res) => {
  const { goodsId, skuId } = req.params;
  try {
    // Get all SKUs for the goods
    const skus = await prisma.goods_sku.findMany({
      where: { goods_id: BigInt(goodsId) },
      include:{
        goods: {
          include:{
            goods_gallery: true
          }
        }
      }
    });

    // Get all spec_value_ids used by these SKUs
    const allSpecValueIds = skus
      .map(sku => sku.spec_value_ids ? sku.spec_value_ids.split(',').map(id => BigInt(id)) : [])
      .flat();
    const uniqueSpecValueIds = Array.from(new Set(allSpecValueIds));

    // Get all spec_values and their specification
    let specValues = [];
    if (uniqueSpecValueIds.length > 0) {
      specValues = await prisma.spec_values.findMany({
        where: { id: { in: uniqueSpecValueIds } },
        include: { specification: true }
      });
    }

    // Build a map: specId -> {specName, values: Set}
    const specMap = {};
    specValues.forEach(sv => {
      const specId = sv.specification?.id;
      if (!specId) return;
      if (!specMap[specId]) {
        specMap[specId] = {
          specName: sv.specification.spec_name,
          values: new Set()
        };
      }
      specMap[specId].values.add(sv.spec_value);
    });
    // Build specList in correct format
    const specList = Object.values(specMap).map(item => ({
      specName: item.specName,
      values: Array.from(item.values)
    }));

    // Build a map for quick lookup: spec_value_id -> {specName, specValue}
    const specValueMap = {};
    specValues.forEach(sv => {
      if (sv.id && sv.specification) {
        specValueMap[sv.id.toString()] = {
          specName: sv.specification.spec_name,
          specValue: sv.spec_value
        };
      }
    });

    // Build specs array (each SKU with its specValues and required fields)
    const specs = skus.map(sku => {
      const ids = sku.spec_value_ids ? sku.spec_value_ids.split(',') : [];
      // For each spec, only keep the first value for that spec in this SKU
      const specValuePerSpec = {};
      ids.forEach(id => {
        const sv = specValueMap[id];
        if (sv && !specValuePerSpec[sv.specName]) {
          specValuePerSpec[sv.specName] = sv.specValue;
        }
      });
      const specValuesArr = Object.entries(specValuePerSpec).map(([specName, specValue]) => ({ specName, specValue }));
      return {
        skuId: sku.id.toString(),
        id: sku.id.toString(),
        goodsId: sku.goods_id ? sku.goods_id.toString() : null,
        quantity: sku.quantity,
        price: sku.price && typeof sku.price.toNumber === 'function' ? sku.price.toNumber() : sku.price,
        specValues: specValuesArr,
        weight: sku.weight && typeof sku.weight.toNumber === 'function' ? sku.weight.toNumber() : sku.weight,
        authFlag: sku.auth_flag || false,
      };
    });

    // Get goods detail
    const goods = await prisma.goods.findUnique({
      where: { id: BigInt(goodsId) },
      include: {
        goods_gallery: { orderBy: { sort: 'asc' } },
        category: { select: { name: true } },
        store:true,
      }
    });

    // Build goodsGalleryList (all images)
    const goodsGalleryList = goods.goods_gallery.map(img => img.original || img.small).filter(Boolean);

    // Compose response, preserving all original fields
    const data = {
      ...goods,
      storeName: goods.store ? goods.store.store_name : null,
      price: goods.price && typeof goods.price.toNumber === 'function' ? goods.price.toNumber() : goods.price,
      grade: goods.grade && typeof goods.grade.toNumber === 'function' ? goods.grade.toNumber() : goods.grade,
      weight: goods.weight && typeof goods.weight.toNumber === 'function' ? goods.weight.toNumber() : goods.weight,
      goodsGalleryList,
      specList,
      specs,
      goodsId: goods.id ? goods.id.toString() : null,
    };
    const result = {
      categoryName: goods.category ? goods.category.name : null,
      data
    };
    const camelCaseResult = camelcaseKeys(result, { deep: true });
    res.json(resultData(camelCaseResult));
  } catch (error) {
    console.error('Error fetching goods SKU:', error);
    res.status(500).json({ code: 500, message: error.message, data: null });
  }
});

// DELETE /buyer/member/storeCollection/delete/STORE/:id
router.delete('/member/storeCollection/delete/STORE/:id',authMiddleware, async (req, res) => {
  const { id } = req.params;
  const userId = req.tokenUser.id; 

  if (!id) {
    return res.status(400).json({ code: 400, message: 'No ID', data: null });
  }
  if (!userId) {
    return res.status(401).json({ code: 401, message: 'No USER ID', data: null });
  }

  try {
    await prisma.store_collection.deleteMany({
      where: { user_id: userId, store_id: id }
    });

    res.json(resultData());
  } catch (error) {
    console.error('Error deleting store collection:', error);
    res.status(500).json({ code: 500, message: error.message, data: null });
  }
});

// DELETE /buyer/member/storeCollection/delete/GOODS/:id
router.delete('/member/storeCollection/delete/GOODS/:id',authMiddleware, async (req, res) => {
  const { id } = req.params;
  const userId = req.tokenUser.id; 

  if (!id) {
    return res.status(400).json({ code: 400, message: 'No ID', data: null });
  }
  if (!userId) {
    return res.status(401).json({ code: 401, message: 'No USER ID', data: null });
  }

  try {
    await prisma.goods_collection.deleteMany({
      where: { user_id: userId, sku_id: id }
    });

    res.json(resultData());
  } catch (error) {
    res.status(500).json({ code: 500, message: error.message, data: null });
  }
});

// POST /buyer/member/storeCollection/add/STORE/:id
router.post('/member/storeCollection/add/STORE/:id',authMiddleware, async (req, res) => {
  const { id } = req.params;
  const userId = req.tokenUser.id; 

  if (!id) {
    return res.status(400).json({ code: 400, message: 'No ID', data: null });
  }
  if (!userId) {
    return res.status(401).json({ code: 401, message: 'No user id', data: null });
  }

  try {
    const exist = await prisma.store_collection.findFirst({
      where: { user_id: userId, store_id: id }
    });
    if (exist) {
      return res.json(resultData(true, 'Store already collected'));
    }

    await prisma.store_collection.create({
      data: {
        user_id: userId,
        store_id: id,
        create_time: new Date()
      }
    });

    res.json(resultData());
  } catch (error) {
    console.error('Error adding store collection:', error);
    res.status(500).json({ code: 500, message: error.message, data: null });
  }
});

// GET /buyer/member/storeCollection/isCollection/STORE/:id
router.get('/member/storeCollection/isCollection/STORE/:id',authMiddleware, async (req, res) => {
  const { id } = req.params;
  const userId = req.tokenUser.id;

  if (!id) {
    return res.status(400).json({ code: 400, message: 'No id', data: null });
  }
  if (!userId) {
    return res.status(401).json({ code: 401, message: 'No user id', data: null });
  }

  try {
    const exist = await prisma.store_collection.findFirst({
      where: { user_id: userId, store_id: id }
    });

    res.json(resultData(!!exist));
  } catch (error) {
    res.status(500).json({ code: 500, message: error.message, data: null });
  }
});

// GET /buyer/store/store/get/detail/:id
router.get('/store/store/get/detail/:id',authMiddleware, async (req, res) => {
  const { id } = req.params;
  if (!id) {
    return res.status(400).json({ code: 400, message: 'No id', data: null });
  }

  try {
    const store = await prisma.store.findUnique({
      where: { id: id },
    });
    const favorited = await prisma.store_collection.findFirst({
      where: { store_id: id, user_id: req.tokenUser ? req.tokenUser.id : null }
    });
    if(favorited) {
      store.is_favorited = true;
    } else {
      store.is_favorited = false;
    }
    if (!store) {
      return res.status(404).json({ code: 404, message: 'Store not exist', data: null });
    }
    const resultC = camelcaseKeys(store, { deep: true });
    res.json(resultData(resultC));
  } catch (error) {
    res.status(500).json({ code: 500, message: error.message, data: null });
  }
});

// POST /buyer/member/address
router.post('/member/address',authMiddleware, async (req, res) => {
  const {name,detail,mobile,alias,isDefault = false} = req.body;
  const userId = req.tokenUser.id; 

  if (!userId) {
    return res.status(401).json({ code: 401, message: 'No user id', data: null });
  }

  try {
    const newAddress = await prisma.user_address.create({
      data: {
        user_id: userId,
        name: name,
        detail: detail,
        mobile: mobile,
        alias: alias,
        is_default: !!isDefault
      }
    });

    res.json(resultData());
  } catch (error) {
    console.error('Error creating address:', error);
    res.status(500).json({ code: 500, message: error.message, data: null });
  }
});

// PUT /buyer/member/address
router.put('/member/address/:id',authMiddleware, async (req, res) => {
  const {name,detail,mobile,alias,isDefault = false} = req.query;
  const userId = req.tokenUser.id;
  const { id } = req.params;
  if (!userId) {
    return res.status(401).json({ code: 401, message: 'No user id', data: null });
  }
  try {
    const exist = await prisma.user_address.findFirst({
      where: { id }
    });
    if (!exist) {
      return res.status(404).json({ code: 404, message: 'No address', data: null });
    }
    // Sửa lại: update theo id (unique key)
    const updatedAddress = await prisma.user_address.update({
      where: { id: exist.id },
      data: {
        name: name,
        detail: detail,
        mobile: mobile,
        alias: alias,
        is_default: !!isDefault
      }
    });
    res.json(resultData());
  } catch (error) {
    console.error('Error updating address:', error);
    res.status(500).json({ code: 500, message: error.message, data: null });
  }
});

// GET /buyer/member/address/get/:id
router.get('/member/address/get/:id', async (req, res) => {
  const { id } = req.params;
  if (!id) {
    return res.status(400).json({ code: 400, message: 'No id', data: null });
  }

  try {
    const address = await prisma.user_address.findUnique({
      where: { id: id }
    });

    if (!address) {
      return res.status(404).json({ code: 404, message: 'No address', data: null });
    }
    const resultC = camelcaseKeys(address, { deep: true });
    res.json(resultData(resultC));
  } catch (error) {
    console.error('Error fetching address:', error);
    res.status(500).json({ code: 500, message: error.message, data: null });
  }
});

// GET /buyer/member/address
router.get('/member/address',authMiddleware, async (req, res) => {
  const userId = req.tokenUser.id; 
  if (!userId) {
    return res.status(401).json({ code: 401, message: 'No user id', data: null });
  }

  const page = Number(req.query.pageNumber) || 1;
  const size = Number(req.query.pageSize) || 10;

  try {
    const [records, total] = await Promise.all([
      prisma.user_address.findMany({
        where: { user_id: userId },
        skip: (page - 1) * size,
        take: size,
        orderBy: { create_time: 'desc' } 
      }),
      prisma.user_address.count({
        where: { user_id: userId }
      })
    ]);

    const result = {
      records,
      total,
      size,
      current: page,
      pages: Math.ceil(total / size)
    };
    const camelCaseResult = camelcaseKeys(result, { deep: true });
    res.json(resultData(camelCaseResult));
  } catch (error) {
    res.status(500).json({ code: 500, message: error.message, data: null });
  }
});

// DELETE /buyer/member/address/delById/:id
router.delete('/member/address/delById/:id',authMiddleware, async (req, res) => {
  const { id } = req.params;
  const userId = req.tokenUser.id;
  if (!id) {
    return res.status(400).json({ code: 400, message: 'No id', data: null });
  }
  if (!userId) {
    return res.status(401).json({ code: 401, message: 'No user id', data: null });
  }

  try {
    await prisma.user_address.findUnique({
      where: { id: id }
    });

    await prisma.user_address.delete({
      where: { id: id }
    });

    res.json(resultSuccess());
  } catch (error) {
    console.error('Error deleting address:', error);
    res.status(500).json({ code: 500, message: error.message, data: null });
  }
});

// GET /buyer/store/address/page/:storeId
router.get('/store/address/page/:storeId', async (req, res) => {
  const { storeId } = req.params;
  const page = Number(req.query.pageNumber) || 1;
  const size = Number(req.query.pageSize) || 10;

  if (!storeId) {
    return res.status(400).json({ code: 400, message: 'no store id', data: null });
  }

  try {
    const [records, total] = await Promise.all([
      prisma.store.findMany({
        where: { id: storeId },
        skip: (page - 1) * size,
        take: size,
        orderBy: { create_time: 'desc' } 
      }),
      prisma.store.count({
        where: { id: storeId }
      })
    ]);
    
    const result = {
      records,
      total,
      size,
      current: page,
      pages: Math.ceil(total / size)
    };
    const camelCaseResult = camelcaseKeys(result, { deep: true });
    res.json(resultData(camelCaseResult));
  } catch (error) {
    res.status(500).json({ code: 500, message: error.message, data: null });
  }
});

// GET /buyer/order/order
router.get('/order/order',authMiddleware, async (req, res) => {
  const userId = req.tokenUser.id;
  if (!userId) {
    return res.status(401).json({ code: 401, message: 'no user id', data: null });
  }
  const page = Number(req.query.pageNumber) || 1;
  const size = Number(req.query.pageSize) || 10;
  const {keywords,tag} = req.query;
  try {
    const where = { member_id: userId };
    if (tag && tag == 'COMPLETE') {
      where.order_status = "PAID";
    } else if(tag && tag == 'WAIT_PAY'){
      where.order_status = "UNPAID";
    }
    if (keywords) {
      where.OR = [
        { sn: { contains: keywords } },
      ];
    }
    const [records, total] = await Promise.all([
      prisma.order.findMany({
        where,
        skip: (page - 1) * size,
        take: size,
        orderBy: { create_time: 'desc' },
        include: {
          sub_order: {
            include: {
              store: { select: { store_name: true, store_logo: true } },
              order_item: {
                include: {
                  goods_sku: {
                    include: {
                      goods: { include: { goods_gallery: true } }
                    }
                  }
                }
              }
            }
          }
        }
      }),
      prisma.order.count({ where })
    ]);
    // Format lại kết quả 
    const result = {
      records: records.map(order => ({
        ...order,
        flow_price: order.flow_price && typeof order.flow_price.toNumber === 'function' ? order.flow_price.toNumber() : order.flow_price,
        goods_price: order.goods_price && typeof order.goods_price.toNumber === 'function' ? order.goods_price.toNumber() : order.goods_price,
        sub_order: order.sub_order.map(sub => ({
          ...sub,
          sub_total: sub.sub_total && typeof sub.sub_total.toNumber === 'function' ? sub.sub_total.toNumber() : sub.sub_total,
          storeName: sub.store ? sub.store.store_name : null,
          storeLogo: sub.store ? sub.store.store_logo : null,
          order_item: sub.order_item.map(item => ({
            ...item,
            unit_price: item.unit_price && typeof item.unit_price.toNumber === 'function' ? item.unit_price.toNumber() : item.unit_price,
            sub_total: item.sub_total && typeof item.sub_total.toNumber === 'function' ? item.sub_total.toNumber() : item.sub_total,
            goods_sku: item.goods_sku ? {
              ...item.goods_sku,
              price: item.goods_sku.price && typeof item.goods_sku.price.toNumber === 'function' ? item.goods_sku.price.toNumber() : item.goods_sku.price,
              goods: item.goods_sku.goods ? {
                ...item.goods_sku.goods,
                price: item.goods_sku.goods.price && typeof item.goods_sku.goods.price.toNumber === 'function' ? item.goods_sku.goods.price.toNumber() : item.goods_sku.goods.price,
                goods_gallery: item.goods_sku.goods.goods_gallery || []
              } : null
            } : null
          }))
        }))
      })),
      total,
      size,
      current: page,
      pages: Math.ceil(total / size)
    };
    const camelCaseResult = camelcaseKeys(result, { deep: true });
    res.json(resultData(camelCaseResult));
  } catch (error) {
    console.error('Error fetching orders:', error);
    res.status(500).json({ code: 500, message: error.message, data: null });
  }
});

async function cancelOrder(orderSn, reason) {
  const order = await prisma.order.findUnique({ where: { sn:orderSn } });
  if (!order) throw new Error('ORDER_NOT_EXIST');
  if (order.status === 'CANCELLED') throw new Error('ORDER_ALREADY_CANCELLED');
  await prisma.order.update({
    where: { sn:orderSn },
    data: {
      status: 'CANCELLED',
      cancel_reason: reason,
      update_time: new Date(),
    },
  });
}

router.post('/order/order/:orderSn/cancel', async (req, res) => {
  const { orderSn } = req.params;
  const { reason } = req.body || req.query  ; 
  try {
    if (!orderSn || !reason) {
      return res.json({ code: 400, message: 'No params', data: null });
    }
    await cancelOrder(orderSn, reason);
    res.json(resultSuccess());
  } catch (err) {
    res.json({ code: 500, message: err.message || 'Error cancel order', data: null });
  }
});

// DELETE /buyer/order/order/:orderSn
router.delete('/order/order/:orderSn', async (req, res) => {
  const { orderSn } = req.params;
  try {
    if (!orderSn) {
      return res.json({ code: 400, message: 'No params', data: null });
    }

    const order = await prisma.order.findUnique({
      where: { sn:orderSn }
    });
    
    await prisma.order.delete({
      where: { sn:orderSn }
    });

    res.json(resultSuccess());
  } catch (err) {
    res.status(400).json({
      code: 400,
      message: err.message || 'Order deletion failed',
      data: null
    });
  }
});
// GET /buyer/order/order/:orderSn
router.get('/order/order/:orderSn', async (req, res) => {
  const { orderSn } = req.params;
  if (!orderSn) {
    return res.status(400).json({ code: 400, message: 'No order sn', data: null });
  }
  try {
    const order = await prisma.order.findUnique({
      where: { sn: orderSn },
      include: {
        sub_order: {
          include: {
            store: { select: { store_name: true, store_logo: true,id:true } },
            order_item: {
              include: {
                goods_sku: {
                  include: {
                    goods: { include: { goods_gallery: true } }
                  }
                }
              }
            }
          }
        }
      }
    });
    if (!order) {
      return res.status(404).json({ code: 404, message: 'Order not found', data: null });
    }
    // Lấy tất cả sku_id của order_item trong các sub_order
    const skuIds = order.sub_order.flatMap(sub => sub.order_item.map(item => item.sku_id)).filter(Boolean);
    // Lấy tất cả đánh giá liên quan đến các sku_id và order_no này
    let evaluations = [];
    if (skuIds.length > 0) {
      evaluations = await prisma.user_evaluation.findMany({
        where: {
          order_no: orderSn,
          sku_id: { in: skuIds }
        }
      });
    }
    // Map evaluations vào từng order_item trong từng sub_order
    order.sub_order = order.sub_order.map(sub => ({
      ...sub,
      sub_total: sub.sub_total && typeof sub.sub_total.toNumber === 'function' ? sub.sub_total.toNumber() : sub.sub_total,
      storeName: sub.store ? sub.store.store_name : null,
      storeLogo: sub.store ? sub.store.store_logo : null,
      order_item: sub.order_item.map(item => {
        const itemEvaluations = evaluations.filter(ev => ev.sku_id && item.sku_id && ev.sku_id.toString() === item.sku_id.toString());
        return {
          ...item,
          unit_price: item.unit_price && typeof item.unit_price.toNumber === 'function' ? item.unit_price.toNumber() : item.unit_price,
          sub_total: item.sub_total && typeof item.sub_total.toNumber === 'function' ? item.sub_total.toNumber() : item.sub_total,
          goods_sku: item.goods_sku ? {
            ...item.goods_sku,
            price: item.goods_sku.price && typeof item.goods_sku.price.toNumber === 'function' ? item.goods_sku.price.toNumber() : item.goods_sku.price,
            goods: item.goods_sku.goods ? {
              ...item.goods_sku.goods,
              price: item.goods_sku.goods.price && typeof item.goods_sku.goods.price.toNumber === 'function' ? item.goods_sku.goods.price.toNumber() : item.goods_sku.goods.price,
              goods_gallery: item.goods_sku.goods.goods_gallery || []
            } : null
          } : null,
          user_evaluation: itemEvaluations
        };
      })
    }));
    const orderDetailVO = {
      order,
      storeId: order.store_id,
      orderStatusValue: order.order_status,
      paymentMethodValue: order.payment_method,
      payStatusValue: order.pay_status,
      flow_price: order.flow_price && typeof order.flow_price.toNumber === 'function' ? order.flow_price.toNumber() : order.flow_price,
      goodsPrice: order.goods_price && typeof order.goods_price.toNumber === 'function' ? order.goods_price.toNumber() : order.goods_price,
      subOrderList: order.sub_order
    };
    const camelCaseResult = camelcaseKeys(orderDetailVO, { deep: true });
    res.json(resultData(camelCaseResult));
  } catch (err) {
    console.error('Error fetching order:', err);
    res.status(err.code || 500).json({ code: err.code || 500, message: err.message, data: null });
  }
});

// PUT /buyer/passport/member/editOwn
router.put('/passport/member/editOwn',authMiddleware, async (req, res) => {
  try {
    
    const userId = req.tokenUser.id; 
    if (!userId) {
      return res.status(401).json({ code: 401, message: 'Unauthorized', data: null });
    }

    let memberEditDTO = req.body;
    if(memberEditDTO.birthday == ""){
      memberEditDTO.birthday = null;
    }
    memberEditDTO = snakecaseKeys(memberEditDTO, { deep: true });
    const updatedMember = await prisma.user.update({
      where: { id: userId },
      data: {
        ...memberEditDTO
      }
    });
    const resultC = camelcaseKeys(updatedMember, { deep: true });
    res.json(resultData(resultC));
  } catch (error) {
    console.error('Error updating member:', error);
    res.status(500).json({ code: 500, message: error.message, data: null });
  }
});

// PUT /buyer/passport/member/modifyPass
router.put('/passport/member/modifyPass',authMiddleware, async (req, res) => {
  const { password, newPassword } = req.body; 
  const userId = req.tokenUser.id;

  if (!userId) {
    return res.json(resultErrorMsg('No user id', 401));
  }
  if (!password || !newPassword) {
    return res.json(resultErrorMsg('No password', 400));
  }
  if (password === newPassword) {
    return res.json(resultErrorMsg('Do not change to the old password', 400));
  }

  try {
    const member = await prisma.user.findUnique({ where: { id: userId } });
    if (!member) {
      return res.json(resultErrorMsg('No user exist', 404));
    }

    const isMatch = password == member.password;
    if (!isMatch) {
      return res.json(resultErrorMsg('Password not match', 400));
    }

    await prisma.user.update({
      where: { id: userId },
      data: { password: newPassword }
    });
    return res.json(resultData());
  } catch (err) {
    console.error('Error changing password:', err);
    return res.json(resultErrorMsg('Change pass error', 500));
  }
});

// GET /buyer/member/collection/GOODS
router.get('/member/collection/GOODS',authMiddleware, async (req, res) => {
  const pageNumber = parseInt(req.query.pageNumber) || 1;
  const pageSize = parseInt(req.query.pageSize) || 10;
  const skip = (pageNumber - 1) * pageSize;
  const take = pageSize;

  const memberId = req.tokenUser.id; 

  const [items, total] = await Promise.all([
    prisma.goods_collection.findMany({
      where: { user_id:memberId },
      skip,
      take,
      orderBy: { create_time: 'desc' },
      include: {
        goods_sku: {
          include: {
            goods: {
              include: {
                goods_gallery: true
              }
            }
          }
        }
      }
    }),
    prisma.goods_collection.count({
      where: { user_id:memberId }
    })
  ]);
  items.forEach(item => {
    item.goods_sku.price = item.goods_sku.price && typeof item.goods_sku.price.toNumber === 'function' ? item.goods_sku.price.toNumber() : item.goods_sku.price;
  })
  const pageResult = {
    pageNumber,
    pageSize,
    total,
    list: items
  };
  const resultC = camelcaseKeys(pageResult, { deep: true });
  res.json(resultData(resultC));
});

// GET /buyer/member/collection/STORE
router.get('/member/collection/STORE',authMiddleware, async (req, res) => {
  const pageNumber = parseInt(req.query.pageNumber) || 1;
  const pageSize = parseInt(req.query.pageSize) || 10;
  const skip = (pageNumber - 1) * pageSize;
  const take = pageSize;

  const memberId = req.tokenUser.id; 

  const [items, total] = await Promise.all([
    prisma.store_collection.findMany({
      where: { memberId },
      skip,
      take,
      orderBy: { create_time: 'desc' }
    }),
    prisma.store_collection.count({
      where: { user_id:memberId }
    })
  ]);

  const pageResult = {
    pageNumber,
    pageSize,
    total,
    list: items
  };
  const resultC = camelcaseKeys(pageResult, { deep: true });
  res.json(resultData(resultC));
});

// GET /buyer/member/storeCollection/STORE
router.get('/member/storeCollection/STORE',authMiddleware, async (req, res) => {
  const pageNo = parseInt(req.query.pageNumber, 10) || 1;
  const pageSize = parseInt(req.query.pageSize, 10) || 10;
  const skip = (pageNo - 1) * pageSize;
  const take = pageSize;

  const memberId = req.tokenUser.id;

  const [list, total] = await Promise.all([
    prisma.store_collection.findMany({
      where: { user_id:memberId },
      skip,
      take,
      orderBy: { create_time: 'desc' },
      include: {
        store:true
      }
    }),
    prisma.store_collection.count({
      where: { user_id:memberId }
    })
  ]);

  const pageVO = {
    pageNumber: pageNo,
    pageSize,
    totalCount: total,
    list
  };
  const resultC = camelcaseKeys(pageVO, { deep: true });
  res.json(resultData(resultC));
});

// GET /buyer/member/evaluation
router.get('/member/evaluation',authMiddleware, async (req, res) => {
  try {
    const memberId = req.tokenUser.id;
    if (!memberId) {
      return res.status(401).json({ code: 401, message: 'Unauthorized', data: null });
    }

    const {
      pageNumber = 1,
      pageSize = 10,
    } = req.query;

    const where = {
      user_id: Number(memberId),
    };
    const total = await prisma.user_evaluation.count({ where });

    const items = await prisma.user_evaluation.findMany({
      where,
      skip: (Number(pageNumber) - 1) * Number(pageSize),
      take: Number(pageSize),
      orderBy: { create_time: 'desc' }, 
      include: {
        goods: {
          include: {
            goods_gallery: true,
          }
        },
      }
    });
    const page = {
      records:items,
      total,
      pageNumber: Number(pageNumber),
      pageSize: Number(pageSize),
    };
    const resultC = camelcaseKeys(page, { deep: true });
    res.json(resultData(resultC));
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message, data: null });
  }
});

// POST /buyer/member/evaluation
router.post('/member/evaluation',authMiddleware, async (req, res) => {
  try {
    // Support both req.body and req.query
    let params = req.body && Object.keys(req.body).length > 0 ? req.body : req.query;
    let {goodsId,orderNo,skuId,serviceScore,grade,content,images,storeId} = params;
    const memberId = req.tokenUser.id;

    // Check if evaluation exists 
    const exist = await prisma.user_evaluation.findFirst({
      where: {
        user_id: BigInt(memberId),
        goods_id: BigInt(goodsId),
        sku_id: BigInt(skuId),
        order_no: orderNo,
        store_id: BigInt(storeId)
      }
    });

    if (exist) {
      await prisma.user_evaluation.update({
        where: { id: exist.id },
        data: {
          service_score: Number(serviceScore),
          grade: grade,
          content: content,
          images: images,
          update_time: new Date()
        }
      });
    } else {
      await prisma.user_evaluation.create({
        data: {
          service_score: Number(serviceScore),
          grade: grade,
          content: content,
          images: images,
          user: {
            connect: { id: BigInt(memberId) } 
          },
          goods: {
            connect: { id: BigInt(goodsId) } 
          },
          goods_sku: {
            connect: { id: BigInt(skuId) } 
          },
          order: {
            connect: { sn: orderNo } 
          },
          store: {
            connect: { id: BigInt(storeId) } 
          },
          create_time: new Date(),
        },
      });
    }

    // Update goods grade (average) and comment_num (count)
    const [allEvaluations, commentNum] = await Promise.all([
      prisma.user_evaluation.findMany({
        where: { goods_id: BigInt(goodsId), service_score: { not: null } },
        select: { grade: true }
      }),
      prisma.user_evaluation.count({ where: { goods_id: BigInt(goodsId) } })
    ]);
    let avgGrade = 0;
    if (allEvaluations.length > 0) {
      // Convert all grades to numbers 
      const grades = allEvaluations.map(ev => Number(ev.service_score)).filter(x => !isNaN(x));
      if (grades.length > 0) {
        avgGrade = grades.reduce((a, b) => a + b, 0) / grades.length;
      }
    }
    await prisma.goods.update({
      where: { id: BigInt(goodsId) },
      data: {
        grade: avgGrade,
        comment_num: commentNum
      }
    });

    res.json(resultData());
  } catch (error) {
    console.error('Error creating/updating evaluation:', error);
    res.status(500).json({ code: 500, message: error.message || 'Internal Server Error' });
  }
});

// GET /buyer/member/evaluation/get/:id
router.get('/member/evaluation/get/:id', async (req, res) => {
  const { id } = req.params;
  if (!id) {
    return res.status(400).json({
      code: 400,
      message: 'No id',
      data: null
    });
  }
  try {
    const evaluation = await prisma.user_evaluation.findUnique({
      where: { id: id },
      include:{
        goods:{
          include: {
            goods_gallery: true
          }
        }
      }
    });
    const resultC = camelcaseKeys(evaluation, { deep: true });
    return res.json(resultData(resultC));
  } catch (error) {
    return res.status(500).json({
      code: 500,
      message: error.message || 'Internal server error',
      data: null
    });
  }
});

//asd bỏ??
// GET /buyer/label/get/:id
router.get('/label/get/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const labels = await prisma.category.findMany({
      where: { }
    });
    res.json({
      code: 200,
      message: 'success',
      data: labels
    });
  } catch (error) {
    res.json({
      code: 500,
      message: error.message || 'Internal server error',
      data: null
    });
  }
});

async function listAllChildren(parentId) {
  const categories = await prisma.category.findMany({
    where: { level: Number(parentId) },
    orderBy: { id: 'asc' } 
  });

  return Promise.all(categories.map(async cat => {
    const children = await listAllChildren(cat.id);
    return {
      ...cat,
      children: children.length > 0 ? children : undefined
    };
  }));
}

function buildCategoryTree(categories, parent_id = null) {
  return categories
    .filter(cat => (cat.parent_id === parent_id || (cat.parent_id == null && parent_id == null)))
    .map(cat => ({
      ...cat,
      children: buildCategoryTree(categories, cat.id)
    }));
}

// GET /manager/goods/category/allChildren
router.get('/goods/category/get/:parentId', async (req, res) => {
  const categories = await prisma.category.findMany({
    orderBy: { sort_order: 'asc' } 
  });
  let categoriesFixCommissionRate = categories.map(cat => ({
    ...cat,
    commission_rate: cat.commission_rate ? parseFloat(cat.commission_rate.toString()) : 0,
  }))
  const tree = buildCategoryTree(categoriesFixCommissionRate);
  const camelCaseResult = camelcaseKeys(tree, { deep: true });

  res.json(resultData(camelCaseResult));
});

// GET /buyer/goods/category/get/:parentId
// router.get('/goods/category/get/:parentId', async (req, res) => {
//   const { parentId } = req.params;
//   if (!parentId) {
//     return res.json({
//       code: 400,
//       message: 'No parent ID provided',
//       data: null
//     });
//   }
//   try {
//     const data = await listAllChildren(parentId);
//     const resultC = camelcaseKeys(data, { deep: true });
//     res.json(resultData(resultC));
//   } catch (err) {
//     console.error('Error fetching categories:', err);
//     res.status(500).json({
//       code: 500,
//       message: err.message || 'Internal server error',
//       data: null
//     });
//   }
// });

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
    
    const newAccessToken = jwt.sign({ id: Number(user.id), username: user.username }, JWT_SECRET, { expiresIn: '1d' });
    const newRefreshToken = jwt.sign({ id: Number(user.id), username: user.username }, JWT_REFRESH_SECRET, { expiresIn: '7d' });
    return { accessToken: newAccessToken, refreshToken: newRefreshToken };
}

// GET /buyer/passport/member/refresh/:refreshToken
router.get('/passport/member/refresh/:refreshToken', async (req, res) => {
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

// POST /buyer/api/create-order
router.post('/api/create-order', async (req, res) => {
  const { items } = req.body;
  const token = req.headers.accesstoken;
  if (!token) {
    return res.status(401).json({ error: 'No accessToken' });
  }
  let tokenUser;
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    tokenUser = decoded;
  } catch (err) {
    return res.status(401).json({ error: 'The token is invalid or expired.' });
  }
  try {
    const userId = tokenUser.id;
    const orderSn = 'ORD' + Date.now();
    const now = new Date();
    // Lấy user và địa chỉ mặc định
    const user = await prisma.user.findUnique({ where: { id: userId } });
    const userAddress = await prisma.user_address.findFirst({ where: { user_id: userId, is_default: true } });
    // Gom nhóm items theo storeId
    const storeMap = {};
    for (const item of items) {
      const storeId = String(item.storeId);
      if (!storeMap[storeId]) storeMap[storeId] = [];
      storeMap[storeId].push(item);
    }
    // Tính tổng số lượng và giá trị đơn hàng
    let totalNum = 0;
    let totalPrice = 0;
    let subOrders = [];
    // Tạo sub_order cho từng store
    for (const storeId in storeMap) {
      const storeItems = storeMap[storeId];
      let subTotal = 0;
      for (const item of storeItems) {
        subTotal += Number(item.unitPrice) * Number(item.quantity);
        totalNum += Number(item.quantity);
        totalPrice += Number(item.unitPrice) * Number(item.quantity);
      }
      subOrders.push({
        order_sn: orderSn,
        store_id: BigInt(storeId),
        sub_total: subTotal,
        status: 'PAID',
        create_time: now
      });
    }
    // Tạo order
    const order = await prisma.order.create({
      data: {
        sn: orderSn,
        create_by: userId.toString(),
        create_time: now,
        update_time: now,
        user: { connect: { id: BigInt(userId) } },
        order_status: 'PAID',
        pay_status: 'PAID',
        goods_num: totalNum,
        goods_price: totalPrice,
        flow_price: totalPrice,
        consignee_name: user.username,
        consignee_mobile: user.mobile,
        consignee_detail: userAddress ? userAddress.detail : '',
      }
    });
    // Tạo sub_order và order_item
    for (const sub of subOrders) {
      const createdSub = await prisma.sub_order.create({ data: sub });
      const storeItems = storeMap[String(sub.store_id)];
      for (const item of storeItems) {
        await prisma.order_item.create({
          data: {
            goods_id: BigInt(item.goodsId),
            sku_id: BigInt(item.skuId),
            num: item.quantity,
            unit_price: item.unitPrice,
            sub_total: Number(item.unitPrice) * Number(item.quantity),
            sub_order_id: createdSub.id,
            create_time: now,
            update_time: now
          }
        });
      }
    }
    // Tạo payment_log
    await prisma.payment_log.create({
      data: {
        order: { connect: { sn: orderSn } },
        create_by: userId.toString(),
        create_time: now,
        user: { connect: { id: BigInt(userId) } },
        pay_status: 'PAID',
        payment_time: now,
        type: 'ORDER'
      }
    });
    res.json({ success: true, orderSn });
  } catch (err) {
    console.error('Order creation error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST buyer/api/send-reset-email
router.post('/api/send-reset-email', async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ success: false, message: 'Email is required' });
  }
  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: 'tichhai39@gmail.com', 
        pass: 'pngc pwxm pfoz ypkk'     
      }
    });
    const resetToken = jwt.sign({ email }, JWT_SECRET, { expiresIn: '1h' });
    const resetLink = `http://localhost:10000/forgetPassword?token=${resetToken}`;
    await transporter.sendMail({
      from: 'vendorvault@gmail.com',
      to: email,
      subject: 'Reset your password',
      text: `Please click the following link to reset your password:\n${resetLink}\nIf you did not request this, please ignore this email.`
    });
    res.json({ success: true });
  } catch (error) {
    console.error('Send email error:', error);
    res.status(500).json({ success: false, message: 'Send email failed!' });
  }
});

// POST /buyer/api/reset-password
router.post('/api/reset-password', async (req, res) => {
  const { email, password,token } = req.body;
  if( !token) {
    return res.status(400).json({ success: false, message: 'Token is required' });
  }
  // Verify the token
  try {
    jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return res.status(400).json({ success: false, message: 'Invalid or expired token' });
  }
  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Email and password are required' });
  }
  try {
    // Tìm user theo email
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    // Cập nhật mật khẩu mới
    await prisma.user.update({
      where: { id: user.id },
      data: { password }
    });
    res.json({ success: true, message: 'Password reset successfully' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ success: false, message: 'Reset password failed!' });
  }
});

// GET /buyer/goods/goods/firstFour
router.get('/goods/goods/firstFour', async (req, res) => {
  try {
    const goods = await prisma.goods.findMany({
      orderBy: { create_time: 'asc' },
      take: 4,
      include: {
        goods_gallery: {
          take: 1,
          orderBy: { sort: 'asc' }
        }
      }
    });
    const result = goods.map(good => ({
      ...good,
    }));
    const camelCaseResult = camelcaseKeys(result, { deep: true });
    res.json(resultData(camelCaseResult));
  } catch (error) {
    res.status(500).json({ code: 500, message: error.message, data: null });
  }
});

// GET /buyer/goods/goods/recommended
router.get('/goods/goods/recommended', async (req, res) => {
  try {
    const goods = await prisma.goods.findMany({
      where: { recommend: true },
      take: 4,
      include: {
        goods_gallery: {
          take: 1,
          orderBy: { sort: 'asc' }
        }
      }
    });
    const result = goods.map(good => ({
      ...good,
      price: good.price && typeof good.price.toNumber === 'function' ? good.price.toNumber() : good.price,
      url:"/goodsList"
    }));
    const camelCaseResult = camelcaseKeys(result, { deep: true });
    res.json(resultData(camelCaseResult));
  } catch (error) {
    res.status(500).json({ code: 500, message: error.message, data: null });
  }
});

module.exports = router;

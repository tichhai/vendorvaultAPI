const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const camelcaseKeys = require('camelcase-keys').default;
const snakecaseKeys = require('snakecase-keys');
const jwt = require('jsonwebtoken');
const { authPlugins } = require('mysql2');
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

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

// PUT /store/goods/goods/update/stocks
router.put('/goods/update/stocks', authMiddleware, async (req, res) => {
  const updateStockList = req.body;
  const storeId = req.storeId;
  if (!storeId) {
    return res.status(401).json({ code: 401, message: 'No StoreID', data: null });
  }
  if (!Array.isArray(updateStockList)) {
    return res.status(400).json({ code: 400, message: 'No update stock list', data: null });
  }

  // Chỉ nhận các item có skuId hợp lệ (số nguyên dương)
  const normalizedList = updateStockList
    .filter(item => item.skuId !== undefined && item.skuId !== null && !isNaN(item.skuId))
    .map(item => ({
      skuId: typeof item.skuId === 'string' ? Number(item.skuId) : item.skuId,
      quantity: typeof item.quantity === 'string' ? Number(item.quantity) : item.quantity
    }))
    .filter(item => Number.isInteger(item.skuId) && item.skuId > 0);

  if (normalizedList.length === 0) {
    return res.status(400).json({ code: 400, message: 'No valid skuId in update list', data: null });
  }

  try {
    const goodsSkuIds = normalizedList.map(item => item.skuId);
    // Lấy danh sách sku thực sự thuộc về store này
    const goodsSkuList = await prisma.goods_sku.findMany({
      where: {
        id: { in: goodsSkuIds },
        store_id: storeId
      },
      select: { id: true }
    });
    const validSkuIds = goodsSkuList.map(sku => Number(sku.id));
    // Lọc lại danh sách update chỉ giữ những sku thuộc store
    const validUpdateList = normalizedList.filter(item => validSkuIds.includes(item.skuId));
    // Thực hiện update stocks cho từng sku hợp lệ
    await Promise.all(validUpdateList.map(item =>
      prisma.goods_sku.update({
        where: { id: item.skuId },
        data: { quantity: item.quantity }
      })
    ));
    // Nếu có skuId không hợp lệ, trả về danh sách đó để FE biết
    const invalidSkuIds = goodsSkuIds.filter(id => !validSkuIds.includes(id));
    res.json({ ...resultSuccess(), invalidSkuIds });
  } catch (error) {
    console.error('Error updating stocks:', error);
    res.status(500).json({ code: 500, message: error.message, data: null });
  }
});

// GET /store/goods/goods/list
router.get('/goods/list',authMiddleware, async (req, res) => {
  const {goodsName,marketEnable,salesModel,id} = req.query;
  
  const pageNo = parseInt(req.query.pageNumber) || 1;
  const pageSize = parseInt(req.query.pageSize) || 10;

  let storeId = req.storeId; 
  const where = { store_id: storeId };
  if (goodsName) where.goods_name = { contains: goodsName };
  if (marketEnable) where.market_enable = marketEnable;
  if (salesModel) where.sales_model = salesModel;
  if (id) where.id = Number(id);

  try {
    const [records, total] = await Promise.all([
      prisma.goods.findMany({
        where,
        skip: (pageNo - 1) * pageSize,
        take: pageSize,
        orderBy: { id: 'asc' }
      }),
      prisma.goods.count({ where })
    ]);
    const result = {
      records,
      total,
      size: pageSize,
      current: pageNo,
      pages: Math.ceil(total / pageSize)
    };
    result.records = await Promise.all(result.records.map(async item => {
      let goodsGallery = await prisma.goods_gallery.findMany({
        where: { goods_id: item.id },
        select: { original: true, small: true }
      });
      return {
        ...item,
        price: item.price ? parseFloat(item.price.toString()) : 0,
        original: goodsGallery[0].original ? goodsGallery[0].original : '',
        goodsGallery
      };
    }));
    const camelCaseResult = camelcaseKeys(result, { deep: true });
    res.json(resultData(camelCaseResult));
  } catch (e) {
    res.json({ code: 500, message: 'Internal server error', data: null });
  }
});

// PUT /store/goods/goods/up?goodsId=
router.put('/goods/up', async (req, res) => {
  let goodsId = req.body.goodsId || req.query.goodsId;
  try {
    await prisma.goods.update({
      where: { id: goodsId  },
      data: { market_enable: 'UPPER' }
    });
    res.json(resultSuccess());
  } catch (e) {
    res.json({ code: 500, message: 'Internal server error', data: null });
  }
});

// PUT /store/goods/goods/under?goodsId=
router.put('/goods/under', async (req, res) => {
  let goodsId = req.body.goodsId || req.query.goodsId;
  try {
    await prisma.goods.update({
      where: { id: goodsId  },
      data: { market_enable: 'DOWN' }
    });
    res.json(resultSuccess());
  } catch (e) {
    res.json({ code: 500, message: 'Internal server error', data: null });
  }
});

// PUT /store/goods/goods/delete?goodsId=
router.put('/goods/delete', async (req, res) => {
  let goodsId = req.body.goodsId || req.query.goodsId;

  try {
    await prisma.goods.delete({
      where: { id: goodsId  }
    });
    res.json(resultSuccess());
  } catch (e) {
    res.json({ code: 500, message: 'Internal server error', data: null });
  }
});

function buildCategoryTree(categories, parent_id = null) {
  return categories
    .filter(cat => (cat.parent_id === parent_id || (cat.parent_id == null && parent_id == null)))
    .map(cat => ({
      ...cat,
      children: buildCategoryTree(categories, cat.id)
    }));
}

// GET /store/goods/label
router.get('/label', async (req, res) => {
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

// POST /store/goods/label
router.post('/label', async (req, res) => {
  let category = req.body;
  // Kiểm tra parentId nếu không phải root
  if (category.parentId && category.parentId !== '0') {
    const parent = await prisma.category.findUnique({ where: { id: category.parentId } });
    if (!parent) {
      return res.status(400).json(resultError('CATEGORY_PARENT_NOT_EXIST'));
    }
    if (category.level >= 4) {
      return res.status(400).json(resultError('CATEGORY_BEYOND_THREE'));
    }
  }

  try {
    category = snakecaseKeys(category);
    // Ép kiểu các trường Int về số nguyên thay vì string
    let { parent_id, sort_order, level, delete_flag, ...rest } = category;
    if (typeof sort_order === 'string') sort_order = parseInt(sort_order, 10);
    if (typeof level === 'string') level = parseInt(level, 10);
    if (typeof parent_id === 'string' && parent_id !== '0') parent_id = parseInt(parent_id, 10);
    if (typeof delete_flag === 'string') delete_flag = delete_flag === '1' || delete_flag.toLowerCase() === 'true';
    const data = {
      ...rest,
      ...(typeof sort_order === 'number' ? { sort_order } : {}),
      ...(typeof level === 'number' ? { level } : {}),
      ...(typeof delete_flag === 'boolean' ? { delete_flag } : {}),
      ...(parent_id && parent_id !== 0 && parent_id !== '0'
        ? { category: { connect: { id: Number(parent_id) } } }
        : {})
    };
    const created = await prisma.category.create({ data });
    res.json(resultData());
  } catch (err) {
    console.error('CATEGORY_SAVE_ERROR:', err); 
    res.status(400).json(resultError('CATEGORY_SAVE_ERROR', err.message || err));
  }
});

// PUT /store/goods/label
router.put('/label', async (req, res) => {
  let category = req.body;
  if (!category.id) {
    return res.status(400).json(resultError('NO_ID_PROVIDED'));
  }

  const catTemp = await prisma.category.findUnique({ where: { id: category.id } });
  if (!catTemp) {
    return res.status(400).json(resultError('CATEGORY_NOT_EXIST'));
  }

  const parentIdRaw = category.parentId;
  const parentIdInt =
    parentIdRaw !== undefined &&
    parentIdRaw !== null &&
    parentIdRaw !== '' &&
    parentIdRaw !== '0' &&
    parentIdRaw !== 0 &&
    parentIdRaw !== 'null' &&
    !isNaN(Number(parentIdRaw))
      ? parseInt(parentIdRaw, 10)
      : null;

  if (parentIdInt) {
    const parent = await prisma.category.findUnique({ where: { id: parentIdInt } });
    if (!parent) {
      return res.status(400).json(resultError('CATEGORY_PARENT_NOT_EXIST'));
    }
    if (category.level >= 4) {
      return res.status(400).json(resultError('CATEGORY_BEYOND_THREE'));
    }
  }

  try {
    category = snakecaseKeys(category);
    // Ép kiểu các trường Int về số nguyên thay vì string
    let { id, parent_id, sort_order, level, delete_flag, ...rest } = category;
    if (typeof sort_order === 'string') sort_order = parseInt(sort_order, 10);
    if (typeof level === 'string') level = parseInt(level, 10);
    if (typeof parent_id === 'string' && parent_id !== '0' && parent_id !== 'null') parent_id = parseInt(parent_id, 10);
    if (typeof delete_flag === 'string') delete_flag = delete_flag === '1' || delete_flag.toLowerCase() === 'true';
    const connectParent = parent_id && parent_id !== 0 && parent_id !== '0' && parent_id !== 'null' && !isNaN(Number(parent_id));
    const data = {
      ...rest,
      ...(typeof sort_order === 'number' ? { sort_order } : {}),
      ...(typeof level === 'number' ? { level } : {}),
      ...(typeof delete_flag === 'boolean' ? { delete_flag } : {}),
      ...(connectParent ? { category: { connect: { id: Number(parent_id) } } } : {})
    };
    const updated = await prisma.category.update({
      where: { id },
      data
    });
    res.json(resultData(updated));
  } catch (err) {
    console.error('CATEGORY_UPDATE_ERROR:', err);
    res.status(400).json(resultError('CATEGORY_UPDATE_ERROR', err.message || err));
  }
});

// DELETE /store/goods/label/:id
router.delete('/label/:id', async (req, res) => {
  const { id } = req.params;

  // Kiểm tra có category con không
  const children = await prisma.category.findMany({ where: { parent_id: id } });
  if (children && children.length > 0) {
    return res.status(400).json(resultError('CATEGORY_HAS_CHILDREN'));
  }

  // Kiểm tra có hàng hóa thuộc category không
  const goodsCount = await prisma.goods.count({ where: { category_id: id } });
  if (goodsCount > 0) {
    return res.status(400).json(resultError('CATEGORY_HAS_GOODS'));
  }

  await prisma.category.delete({ where: { id } });

  res.json(resultSuccess());
});

function buildCategoryTree(categories, parent_id = null) {
  return categories
    .filter(cat => (cat.parent_id === parent_id || (cat.parent_id == null && parent_id == null)))
    .map(cat => ({
      ...cat,
      children: buildCategoryTree(categories, cat.id)
    }));
}

// GET /store/goods/category/all
router.get('/category/all', async (req, res) => {
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

// GET /store/goods/category/:categoryId/brands
router.get('/category/:categoryId/brands', async (req, res) => {
  const { categoryId } = req.params;
  try {
    const categoryBrands = await prisma.category_brand.findMany({
      where: { category_id:categoryId },
      include: { brand: true } 
    });
    const result = categoryBrands.map(cb => ({
      ...cb.brand,
    }));
    res.json(result);
  } catch (e) {
    res.status(500).json([]);
  }
});

// GET /store/goods/goodsUnit
router.get('/goodsUnit', async (req, res) => {
  const pageNo = parseInt(req.query.pageNumber) || 1;
  const pageSize = parseInt(req.query.pageSize) || 10;

  try {
    const [records, total] = await Promise.all([
      prisma.goods_unit.findMany({
        skip: (pageNo - 1) * pageSize,
        take: pageSize,
        orderBy: { id: 'asc' }
      }),
      prisma.goods_unit.count()
    ]);
    const result = {
      records,
      total,
      size: pageSize,
      current: pageNo,
      pages: Math.ceil(total / pageSize)
    };
    const camelCaseResult = camelcaseKeys(result, { deep: true });
    res.json(resultData(camelCaseResult));
  } catch (e) {
    res.json({ code: 500, message: 'Internal server error', data: null });
  }
});

// POST /store/goods/goods/create
router.post('/goods/create',authMiddleware, async (req, res) => {
  const body = req.body;
  const unit = await prisma.goods_unit.findFirst({ where: { name: body.goodsUnit } });
  const goodsData = {
    goods_unit_goods_goods_unitTogoods_unit: unit ? { connect: { id: BigInt(unit.id) } } : undefined,
    goods_name: body.goodsName,
    price: body.price ? Number(body.price) : undefined,
    sales_model: body.salesModel,
    params: body.intro,
    market_enable: body.release === true ? 'UPPER' : 'DOWN',
    recommend: body.recommend === true,
    create_time: new Date(),
    update_time: new Date(),
    auth_flag: "TOBEAUDITED",
    brand: body.brandId ? { connect: { id: BigInt(body.brandId) } } : undefined,
    category: body.categoryPath ? { connect: { id: BigInt(body.categoryPath.split(',').pop()) } } : undefined,
  };

  try {
    const createdGoods = await prisma.goods.create({ data: {
      ...goodsData,
      store:{ connect: { id: BigInt(req.storeId) }}
    } });
    const goodsId = createdGoods.id;
   
    if (Array.isArray(body.goodsGalleryList) && body.goodsGalleryList.length > 0) {
      await prisma.goods_gallery.createMany({
        data: body.goodsGalleryList.map(url => ({ goods_id: goodsId, original: url, small: url })),
        skipDuplicates: true
      });
    }

    // tạo specification, spec_values, goods_sku 
    let totalQuantity = 0;
    if (Array.isArray(body.skuList) && body.skuList.length > 0) {
      // Lấy tất cả tên thuộc tính động (không phải các trường mặc định)
      const defaultKeys = ['cost','price', 'quantity', 'sn', 'images', 'weight', 'id'];
      // Lấy key gốc, không chuyển đổi chữ hoa/thường ở đây
      const specNames = Object.keys(body.skuList[0]).filter(k => !defaultKeys.includes(k));
      // Lấy trước toàn bộ specification của store này để tránh truy vấn lặp lại
      const allSpecs = await prisma.specification.findMany({ where: { store_id: BigInt(req.storeId) } });
      const specNameToId = {};
      for (const specName of specNames) {
        // So sánh chuẩn hóa: loại bỏ khoảng trắng, lowercase
        const cleanSpecName = (specName || '').replace(/\s+/g, '').toLowerCase();
        let spec = allSpecs.find(s => ((s.spec_name || '').replace(/\s+/g, '').toLowerCase() === cleanSpecName));
        if (!spec) {
          spec = await prisma.specification.create({
            data: {
              spec_name: specName.trim(),
              store_id: BigInt(req.storeId),
              create_time: new Date(),
              create_by: "SELLER"
            }
          });
          allSpecs.push(spec);
        }
        specNameToId[specName] = spec.id;
      }
      // Đảm bảo mỗi spec value có 1 spec_values (tạo mới nếu chưa có, so sánh không phân biệt hoa thường, loại bỏ khoảng trắng)
      const specValueMap = {}; // { specName: { value: id } }
      for (const specName of specNames) {
        specValueMap[specName] = {};
        const values = Array.from(new Set(body.skuList.map(sku => sku[specName])));
        // Lấy trước toàn bộ spec_values của spec này
        const allSpecValues = await prisma.spec_values.findMany({ where: { spec_id: specNameToId[specName] } });
        for (const value of values) {
          const cleanValue = String(value ?? '').replace(/\s+/g, '').toLowerCase();
          let specValue = allSpecValues.find(v => String(v.spec_value ?? '').replace(/\s+/g, '').toLowerCase() === cleanValue);
          if (!specValue) {
            specValue = await prisma.spec_values.create({
              data: {
                spec_id: specNameToId[specName],
                spec_value: String(value ?? '').trim(),
                create_time: new Date(),
                create_by: "SELLER"
              }
            });
            allSpecValues.push(specValue);
          }
          specValueMap[specName][value] = specValue.id;
        }
      }
      // Tạo goods_sku, lưu spec_value_ids
      for (const sku of body.skuList) {
        const specValueIds = specNames.map(specName => specValueMap[specName][sku[specName]]).filter(Boolean).join(',');
        await prisma.goods_sku.create({
          data: {
            goods: { connect: { id: goodsId } },
            price: sku.price ? Number(sku.price) : undefined,
            quantity: sku.quantity ? Number(sku.quantity) : undefined,
            sn: sku.sn,
            weight: sku.weight ? Number(sku.weight) : undefined,
            original: sku.images[0],
            recommend: false,
            auth_flag: "TOBEAUDITED",
            spec_value_ids: specValueIds || '',
            brand: body.brandId ? { connect: { id: BigInt(body.brandId) } } : undefined,
            store:{ connect: { id: BigInt(req.storeId) }}
          }
        });
        // Cộng dồn quantity
        totalQuantity += sku.quantity ? Number(sku.quantity) : 0;
      }
      // Sau khi tạo xong tất cả goods_sku, cập nhật lại quantity cho goods
      await prisma.goods.update({
        where: { id: goodsId },
        data: { quantity: totalQuantity }
      });
    }
    res.json(resultSuccess());
  } catch (e) {
    console.error('Error creating goods:', e);
    res.json({ code: 500, message: 'Internal server error', data: null });
  }
});

// PUT /store/goods/goods/update/:goodsId
router.put('/goods/update/:goodsId', authMiddleware, async (req, res) => {
  const { goodsId } = req.params;
  const body = req.body;
  try {
    // Lấy thông tin đơn vị tính
    const unit = body.goodsUnit ? await prisma.goods_unit.findFirst({ where: { name: body.goodsUnit } }) : null;
    // Chuẩn bị dữ liệu update
    const goodsData = {
      goods_unit_goods_goods_unitTogoods_unit: unit ? { connect: { id: BigInt(unit.id) } } : undefined,
      goods_name: body.goodsName,
      price: body.price ? Number(body.price) : undefined,
      sales_model: body.salesModel,
      params: body.intro,
      market_enable: body.release === true ? 'UPPER' : 'DOWN',
      recommend: body.recommend === true,
      update_time: new Date(),
      brand: body.brandId ? { connect: { id: BigInt(body.brandId) } } : undefined,
      category: body.categoryPath ? { connect: { id: BigInt(body.categoryPath.split(',').pop()) } } : undefined,
    };
    // Xóa các trường undefined để tránh lỗi Prisma
    Object.keys(goodsData).forEach(key => goodsData[key] === undefined && delete goodsData[key]);

    // Update goods
    await prisma.goods.update({
      where: { id: goodsId },
      data: goodsData
    });

    // Xử lý gallery: Xóa hết ảnh cũ, thêm mới
    if (Array.isArray(body.goodsGalleryList)) {
      await prisma.goods_gallery.deleteMany({ where: { goods_id: goodsId } });
      if (body.goodsGalleryList.length > 0) {
        await prisma.goods_gallery.createMany({
          data: body.goodsGalleryList.map(url => ({ goods_id: goodsId, original: url, small: url })),
          skipDuplicates: true
        });
      }
    }

    // Xử lý sku: Xóa hết sku cũ, thêm mới và đồng bộ specification/spec_values như hàm tạo
    let totalQuantity = 0;
    if (Array.isArray(body.skuList)) {
      await prisma.goods_sku.deleteMany({ where: { goods_id: goodsId } });
      if (body.skuList.length > 0) {
        // Lấy tất cả tên thuộc tính động (không phải các trường mặc định)
        const defaultKeys = ['price', 'quantity', 'sn', 'images', 'weight', 'id'];
        // Lấy key gốc, không chuyển đổi chữ hoa/thường ở đây
        const specNames = Object.keys(body.skuList[0]).filter(k => !defaultKeys.includes(k));
        // Lấy trước toàn bộ specification của store này để tránh truy vấn lặp lại
        const allSpecs = await prisma.specification.findMany({ where: { store_id: BigInt(req.storeId) } });
        const specNameToId = {};
        for (const specName of specNames) {
          // So sánh chuẩn hóa: loại bỏ khoảng trắng, lowercase
          const cleanSpecName = (specName || '').replace(/\s+/g, '').toLowerCase();
          let spec = allSpecs.find(s => ((s.spec_name || '').replace(/\s+/g, '').toLowerCase() === cleanSpecName));
          // Debug log để kiểm tra giá trị đang so sánh
          if (!spec) {
            spec = await prisma.specification.create({
              data: {
                spec_name: specName.trim(),
                store_id: BigInt(req.storeId),
                create_time: new Date(),
                create_by: "SELLER"
              }
            });
            allSpecs.push(spec);
          }
          specNameToId[specName] = spec.id;
        }
        // Đảm bảo mỗi spec value có 1 spec_values (tạo mới nếu chưa có, so sánh không phân biệt hoa thường, loại bỏ khoảng trắng)
        const specValueMap = {}; // { specName: { value: id } }
        for (const specName of specNames) {
          specValueMap[specName] = {};
          const values = Array.from(new Set(body.skuList.map(sku => sku[specName])));
          // Lấy trước toàn bộ spec_values của spec này
          const allSpecValues = await prisma.spec_values.findMany({ where: { spec_id: specNameToId[specName] } });
          for (const value of values) {
            const cleanValue = String(value ?? '').replace(/\s+/g, '').toLowerCase();
            let specValue = allSpecValues.find(v => String(v.spec_value ?? '').replace(/\s+/g, '').toLowerCase() === cleanValue);
            // Debug log để kiểm tra giá trị đang so sánh
            if (!specValue) {
              specValue = await prisma.spec_values.create({
                data: {
                  spec_id: specNameToId[specName],
                  spec_value: String(value ?? '').trim(),
                  create_time: new Date(),
                  create_by: "SELLER"
                }
              });
              allSpecValues.push(specValue);
            }
            specValueMap[specName][value] = specValue.id;
          }
        }
        // Tạo lại goods_sku, lưu spec_value_ids
        for (const sku of body.skuList) {
          const specValueIds = specNames.map(specName => specValueMap[specName][sku[specName]]).filter(Boolean).join(',');
          await prisma.goods_sku.create({
            data: {
              goods: { connect: { id: goodsId } },
              price: sku.price ? Number(sku.price) : undefined,
              quantity: sku.quantity ? Number(sku.quantity) : undefined,
              sn: sku.sn,
              weight: sku.weight ? Number(sku.weight) : undefined,
              original: sku.images && sku.images[0],
              recommend: false,
              auth_flag: "TOBEAUDITED",
              spec_value_ids: specValueIds || '',
              brand: body.brandId ? { connect: { id: BigInt(body.brandId) } } : undefined,
              store:{ connect: { id: BigInt(req.storeId) }}
            }
          });
          totalQuantity += sku.quantity ? Number(sku.quantity) : 0;
        }
        // Sau khi thêm lại goods_sku, cập nhật lại quantity tổng cho goods
        await prisma.goods.update({
          where: { id: goodsId },
          data: { quantity: totalQuantity }
        });
      } else {
        // Nếu không có sku nào, set quantity = 0
        await prisma.goods.update({
          where: { id: goodsId },
          data: { quantity: 0 }
        });
      }
    }
    res.json(resultSuccess());
  } catch (e) {
    console.error('Error updating goods:', e);
    res.json({ code: 500, message: 'Internal server error', data: null });
  }
});

// GET /store/goods/goods/get/:goodsId
router.get('/goods/get/:goodsId', authMiddleware, async (req, res) => {
  const { goodsId } = req.params;
  try {
    // Lấy thông tin sản phẩm
    const goods = await prisma.goods.findUnique({
      where: { id: BigInt(goodsId) },
      include: {
        goods_unit_goods_goods_unitTogoods_unit: true,
        brand: true,
        category: true,
        goods_gallery: true,
        goods_sku: true
      }
    });

    if (!goods) {
      return res.json({ code: 404, message: 'Goods not found', data: null });
    }

    // Gallery
    const goodsGalleryList = goods.goods_gallery.map(g => g.original);

    // SKU & SpecValue
    // Lấy spec_value_ids từ từng sku, truy vấn spec_values
    let skuList = [];
    if (goods.goods_sku && goods.goods_sku.length > 0) {
      // Lấy tất cả spec_value_ids (dạng chuỗi, có thể là '1,2,3')
      const allSpecValueIds = Array.from(new Set(goods.goods_sku.flatMap(sku =>
        (sku.spec_value_ids ? sku.spec_value_ids.split(',').filter(x => x && x !== 'null') : [])
      )));
      // Lấy thông tin spec_value và specification liên quan
      let specValueMap = {};
      if (allSpecValueIds.length > 0) {
        const specValues = await prisma.spec_values.findMany({
          where: { id: { in: allSpecValueIds.map(id => BigInt(id)) } },
          include: { specification: true }
        });
        specValueMap = Object.fromEntries(specValues.map(v => [v.id.toString(), v]));
      }
      skuList = goods.goods_sku.map(sku => {
        let specValueIds = (sku.spec_value_ids ? sku.spec_value_ids.split(',').filter(x => x && x !== 'null') : []);
        if (specValueIds.length === 0 && allSpecValueIds.length > 0) {
          specValueIds = allSpecValueIds;
        }
        const specList = specValueIds.map(id => {
          const v = specValueMap[id];
          const spec = v?.specification;
          return v && spec ? {
            specName: spec.spec_name,
            specNameId: spec.id,
            specValue: v.spec_value,
            specValueId: v.id,
            specImage: sku.original ? sku.original : ""
          } : null;
        }).filter(Boolean);
        let finalSpecList = specList;
        if (finalSpecList.length === 0 && allSpecValueIds.length > 0) {
          finalSpecList = allSpecValueIds.map(id => {
            const v = specValueMap[id];
            const spec = v?.specification;
            return v && spec ? {
              specName: spec.spec_name,
              specNameId: spec.id,
              specValue: v.spec_value,
              specValueId: v.id,
              specImage: sku.original ? sku.original : ""
            } : null;
          }).filter(Boolean);
        }
        return {
          id: sku.id,
          sn: sku.sn,
          price: sku.price && typeof sku.price.toNumber === 'function' ? sku.price.toNumber() : Number(sku.price) || 0,
          quantity: sku.quantity,
          weight: sku.weight && typeof sku.weight.toNumber === 'function' ? sku.weight.toNumber() : Number(sku.weight) || 0,
          images: sku.original ? [sku.original] : [],
          specList: finalSpecList
        };
      });
    }

    // Lấy danh sách brand cho select (đơn giản hóa)
    let brandList = await prisma.category_brand.findMany({
      where: { category_id: goods.category_id },
      include: { brand: true }
    });
    brandList = brandList.map(cb => ({
      id: cb.brand.id,
      name: cb.brand.name
    }));
    // Lấy đủ 3 cấp tên category
    let categoryName = [];
    let cat = goods.category;
    for (let i = 0; i < 3 && cat; i++) {
      categoryName.unshift(cat.name);
      if (cat.parent_id) {
        cat = await prisma.category.findUnique({ where: { id: cat.parent_id } });
      } else {
        cat = null;
      }
    }
    while (categoryName.length < 3) categoryName.unshift('');

    // Trả về dữ liệu
    res.json({
      code: 200,
      message: '',
      result: {
        id: goods.id,
        goodsName: goods.goods_name,
        price: goods.price && typeof goods.price.toNumber === 'function' ? goods.price.toNumber() : Number(goods.price) || 0,
        salesModel: goods.sales_model,
        intro: goods.params,
        release: goods.market_enable === 'UPPER',
        recommend: goods.recommend,
        brandId: goods.brand_id,
        goodsUnit: goods.goods_unit_goods_goods_unit?.name,
        categoryPath: goods.category_id ? goods.category_id.toString() : '',
        categoryName,
        goodsGalleryList,
        skuList,
        brandList,
        goodsUnit: goods.goods_unit_goods_goods_unitTogoods_unit.name || '',
      }
    });
  } catch (e) {
    console.error('Error get goods:', e);
    res.json({ code: 500, message: 'Internal server error', data: null });
  }
});

// GET /store/goods/goods/sku/list
router.get('/goods/sku/list', authMiddleware,async (req, res) => {
  const { pageSize = 1000,page = 1, goodsId, ...filters } = req.query;
  const storeId = req.storeId;
  if (!storeId) {
    return res.status(401).json({ code: 401, message: 'No storeID', data: null });
  }

  where = { store_id: storeId};
  if (goodsId) {
    where.goods_id = Number(goodsId);
  }
  try {
    const [records, total] = await Promise.all([
      prisma.goods_sku.findMany({
        where,
        skip: (Number(page) - 1) * Number(pageSize),
        take: Number(pageSize),
        orderBy: { id: 'desc' } 
      }),
      prisma.goods_sku.count({ where})
    ]);

    const result = {
      records,
      total,
      size: Number(pageSize),
      current: Number(page),
      pages: Math.ceil(total / pageSize)
    };
    const camelCaseResult = camelcaseKeys(result, { deep: true });
    res.json(resultData(camelCaseResult));
  } catch (error) {
    res.status(500).json({ code: 500, message: error.message, data: null });
  }
});

// GET /store/goods/spec/:categoryId
router.get('/spec/:categoryId', async (req, res) => {
  const { categoryId } = req.params;
  if (!categoryId) {
    return res.status(400).json({ code: 400, message: 'No Category ID', data: null });
  }

  try {
    const categorySpecs = await prisma.category_specification.findMany({
      where: { category_id: categoryId },
      include: {
        specification: {
          include: {
            spec_values: true
          }
        }
      }
    });
    // Map lại để specValue là chuỗi ngăn cách bởi dấu phẩy
    const data = categorySpecs.map(cs => {
      const spec = cs.specification;
      const specValueStr = Array.isArray(spec.spec_values)
        ? spec.spec_values.map(v => v.spec_value).join(',')
        : '';
      return {
        ...cs,
        specification: {
          ...spec,
          specValue: specValueStr
        }
      };
    });
    const camelCaseResult = camelcaseKeys(data, { deep: true });
    res.json({ code: 200, data: camelCaseResult });
  } catch (error) {
    res.status(500).json({ code: 500, message: error.message, data: null });
  }
});

module.exports = router;

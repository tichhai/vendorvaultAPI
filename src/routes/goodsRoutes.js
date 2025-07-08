// routes/order.js
const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const camelcaseKeys = require('camelcase-keys').default;
const snakecaseKeys = require('snakecase-keys');
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

// GET /manager/goods/goods/list
router.get('/goods/list', async (req, res) => {
  const { pageNum = 1, pageSize = 10, goodsName, id, marketEnable, salesModel, storeName, ...otherParams } = req.query;

  const where = {};
  if (goodsName) where.goods_name = { contains: goodsName };
  if (id) where.id = Number(id);
  if (marketEnable) where.market_enable = marketEnable;
  if (salesModel) where.sales_model = salesModel;

  // Nếu có storeName thì join sang bảng store để lọc
  let storeIds = [];
  if (storeName) {
    const stores = await prisma.store.findMany({
      where: { store_name: { contains: storeName } },
      select: { id: true }
    });
    storeIds = stores.map(s => s.id);
    if (storeIds.length > 0) {
      where.store_id = { in: storeIds };
    } else {
      where.store_id = -1; // Không có store nào khớp, trả về rỗng
    }
  }

  const [records, total] = await Promise.all([
    prisma.goods.findMany({
      where,
      skip: (parseInt(pageNum) - 1) * parseInt(pageSize),
      take: parseInt(pageSize),
      orderBy: { id: 'desc' },
      include: {
        store:true,
        goods_gallery:true
      }
    }),
    prisma.goods.count({ where })
  ]);
const recordsWithExtra = records.map(record => ({
    ...record,
    price: record.price && typeof record.price.toNumber === 'function' ? record.price.toNumber() : record.price,
    storeName: record.store ? record.store.store_name : null,
  }));
  const result = {
    records:recordsWithExtra,
    total,
    size: parseInt(pageSize),
    current: parseInt(pageNum),
    pages: Math.ceil(total / parseInt(pageSize))
  };
const camelCaseResult = camelcaseKeys(result, { deep: true });

  res.json(resultData(camelCaseResult));
});

function resultError(message) {
  return {
    code: 400,
    message,
    data: null
  };
}

// PUT /manager/goods/goods/:goodsId/up
router.put('/goods/:goodsId/up', async (req, res) => {
  const goodsId = req.params.goodsId;

  const updateResult = await prisma.goods.update({
    where: { id: goodsId  },
    data: { market_enable: 'UPPER' } 
  });

  if (updateResult) {
    res.json(resultSuccess());
  } else {
    res.status(400).json(resultError('GOODS_UPPER_ERROR'));
  }
});

// PUT /manager/goods/goods/:goodsId/under?reason=
router.put('/goods/:goodsId/under', async (req, res) => {
  const goodsId = req.params.goodsId;
  const reason = req.body.reason;
  if (!reason) {
    return res.status(400).json(resultError('The reason for removal cannot be empty'));
  }

  const updateResult = await prisma.goods.update({
    where: { id: goodsId },
    data: {
      market_enable: 'DOWN', 
      under_message: reason 
    }
  });

  if (updateResult) {
    res.json(resultSuccess());
  } else {
    res.status(400).json(resultError('GOODS_UNDER_ERROR'));
  }
});

// GET /manager/goods/goods/get/:id
router.get('/goods/get/:id', async (req, res) => {
  const { id } = req.params;
  const goods = await prisma.goods.findUnique({
    where: { id: Number(id) },
    include: {
      store: { select: { store_name: true } },
      goods_gallery: { select: { original: true, small: true} },
      goods_sku: true,
      goods_unit_goods_goods_unitTogoods_unit:true
    }
  });
  if (!goods) return res.status(404).json(resultData(null));

  // Lấy gallery list
  const goodsGalleryList = goods.goods_gallery?.map(g => g.original).filter(Boolean) || [];

  // Lấy storeName
  const storeName = goods.store?.store_name || null;

  // Lấy skuList và gán goodsName từ goods.goods_name nếu thiếu
  const skuList = goods.goods_sku?.map(sku => ({
    ...sku,
    price: sku.price && typeof sku.price.toNumber === 'function' ? sku.price.toNumber() : sku.price,
    small: sku.small,
    original: sku.original,
    goodsName: sku.goods_name || goods.goods_name, 
    recommend: sku.recommend,
    salesModel: sku.sales_model,
    goodsType: sku.goods_type,
    alertQuantity: sku.alert_quantity,
    specList: [], 
    goodsGalleryList: [], 
  })) || [];

  // Chuyển đổi các trường decimal về number
  function toNumber(val) {
    return val && typeof val.toNumber === 'function' ? val.toNumber() : val;
  }

  const result = {
    id: goods.id?.toString(),
    createBy: goods.create_by,
    createTime: goods.create_time,
    updateBy: goods.update_by,
    updateTime: goods.update_time,
    deleteFlag: false,
    goodsName: goods.goods_name,
    price: toNumber(goods.price),
    brandId: goods.brand_id?.toString(),
    sellingPoint: goods.selling_point,
    marketEnable: goods.market_enable,
    intro: goods.intro,
    buyCount: goods.buy_count,
    quantity: goods.quantity,
    grade: goods.grade,
    small: goods.goods_gallery?.[0]?.small || null,
    original: goods.goods_gallery?.[0]?.original || null,
    storeCategoryPath: goods.store_category_path,
    commentNum: goods.comment_num,
    storeId: goods.store_id?.toString(),
    storeName,
    templateId: goods.template_id?.toString(),
    authFlag: goods.auth_flag,
    authMessage: goods.auth_message,
    underMessage: goods.under_message,
    selfOperated: goods.self_operated,
    recommend: goods.recommend,
    salesModel: goods.sales_model,
    goodsType: goods.goods_type,
    params: goods.params,
    goodsParamsDTOList: [], 
    goodsGalleryList,
    skuList,
    wholesaleList: null,
    goodsUnit: goods.goods_unit_goods_goods_unitTogoods_unit ? goods.goods_unit_goods_goods_unitTogoods_unit.name : null,
  };

  res.json({
    success: true,
    message: 'success',
    code: 200,
    result
  });
});

// GET /manager/goods/goods/auth/list
router.get('/goods/auth/list', async (req, res) => {
  const { pageNum = 1, pageSize = 10, goodsName, id, ...otherParams } = req.query;

  const where = { auth_flag: 'TOBEAUDITED' };
  if (goodsName) where.goods_name = { contains: goodsName };
  if (id) where.id = Number(id);


  const [records, total] = await Promise.all([
    prisma.goods.findMany({
      where,
      skip: (parseInt(pageNum) - 1) * parseInt(pageSize),
      take: parseInt(pageSize),
      orderBy: { id: 'desc' },
      include: {
        store: { select: { store_name: true } },
        goods_gallery:true
      }
    }),
    prisma.goods.count({ where })
  ]);
const recordsWithExtra = records.map(record => ({
    ...record,
    price: record.price && typeof record.price.toNumber === 'function' ? record.price.toNumber() : record.price,
    storeName: record.store ? record.store.store_name : null,
  }));
  const result = {
    records:recordsWithExtra,
    total,
    size: parseInt(pageSize),
    current: parseInt(pageNum),
    pages: Math.ceil(total / parseInt(pageSize))
  };
  const camelCaseResult = camelcaseKeys(result, { deep: true });

  res.json(resultData(camelCaseResult));
});

// PUT /manager/goods/goods/:goodsId/auth?authFlag=...&auth_flag=1...
router.put('/goods/:goodsId/auth', async (req, res) => {
  const goodsId = req.params.goodsId;
  const authFlag = req.body.authFlag;
  if (!authFlag) {
    return res.status(400).json(resultError('The audit result cannot be empty'));
  }
  try{
  const updateResult = await prisma.goods.update({
    where: { id: goodsId  },
    data: { auth_flag: authFlag }
  });
  await prisma.goods_sku.updateMany({
    where: { goods_id: goodsId },
    data: { auth_flag: authFlag }
  });
  res.json(resultSuccess());
} catch (err) {
    console.error('GOODS_AUTH_ERROR:', err);
    res.status(500).json(resultError('GOODS_AUTH_ERROR', err.message || err));
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

// GET /manager/goods/category/allChildren
router.get('/category/allChildren', async (req, res) => {
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

// POST /manager/goods/category
router.post('/category', async (req, res) => {
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

// PUT /manager/goods/category
router.put('/category', async (req, res) => {
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

// DELETE /manager/goods/category/:id
router.delete('/category/:id', async (req, res) => {
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

// PUT /manager/goods/category/disable/:id?enableOperations=true
router.put('/category/disable/:id', async (req, res) => {
  const { id } = req.params;
  let enableOperations = req.query.enableOperations;
  if (typeof enableOperations === 'undefined') {
    enableOperations = req.body.enableOperations;
  }
  // Chuyển sang boolean nếu là string
  if (typeof enableOperations === 'string') {
    enableOperations = enableOperations === 'true';
  }

  const category = await prisma.category.findUnique({ where: { id } });
  if (!category) {
    return res.status(400).json(resultError('CATEGORY_NOT_EXIST'));
  }

  await prisma.category.update({
    where: { id },
    data: { delete_flag: enableOperations }
  });

  res.json(resultSuccess());
});

// GET /manager/goods/brand/all
router.get('/brand/all', async (req, res) => {
  const brands = await prisma.brand.findMany({
    orderBy: { id: 'asc' }
  });
  const camelCaseResult = camelcaseKeys(brands, { deep: true });

  res.json([...camelCaseResult]);
});

// GET /manager/goods/categoryBrand/:categoryId
router.get('/categoryBrand/:category_id', async (req, res) => {
  const { category_id } = req.params;
  try {
    const categoryBrands = await prisma.category_brand.findMany({
      where: { category_id: category_id },
      include: {
        brand: true 
      }
    });
    const result = categoryBrands.map(cb => ({
      ...cb.brand,
    }));
    const camelCaseResult = camelcaseKeys(result, { deep: true });
    res.json(resultData(camelCaseResult));
  } catch (e) {
    res.json({ code: 500, message: 'Internal server error', data: null });
  }
});

// GET /manager/goods/spec/all
router.get('/spec/all', async (req, res) => {
  try {
    const specs = await prisma.specification.findMany();
    const camelCaseResult = camelcaseKeys(specs, { deep: true });
    res.json(resultData(camelCaseResult));
  } catch (e) {
    res.json({ code: 500, message: 'Internal server error', data: null });
  }
});

// GET /manager/goods/categorySpec/:categoryId
router.get('/categorySpec/:category_id', async (req, res) => {
  const { category_id } = req.params;
  try {
    const categorySpecs = await prisma.category_specification.findMany({
      where: { category_id: category_id },
      include: {
        specification: {
          include: {
            spec_values: true
          }
        }
      }
    });
    
    const result = categorySpecs.map(cs => ({
      id: cs.specification.id.toString(),
      specName: cs.specification.spec_name,
      storeId: cs.specification.store_id ? cs.specification.store_id.toString() : null,
      specValue: cs.specification.spec_values.map(sv => sv.spec_value).join(',')
    }));
    res.json(resultData(result));
  } catch (e) {
    res.status(500).json([]);
  }
});

// POST /manager/goods/categoryBrand/:categoryId
router.post('/categoryBrand/:category_id', async (req, res) => {
  const { category_id } = req.params;
  let categoryBrands = req.body.categoryBrands || req.query.categoryBrands;
  // Nếu là chuỗi dạng '16,17' thì tách thành mảng
  if (typeof categoryBrands === 'string') {
    if (categoryBrands.includes(',')) {
      categoryBrands = categoryBrands.split(',').map(x => x.trim()).filter(Boolean);
    } else {
      categoryBrands = [categoryBrands];
    }
  }
  if (!Array.isArray(categoryBrands)) {
    return res.json({ code: 400, message: 'categoryBrands must be an array', data: null });
  }
  try {
    await prisma.category_brand.deleteMany({ where: { category_id: category_id } });
    if (categoryBrands.length > 0) {
      await prisma.category_brand.createMany({
        data: categoryBrands.map(brandId => ({
          category_id: category_id,
          brand_id: brandId
        })),
        skipDuplicates: true
      });
    }
    res.json(resultSuccess());
  } catch (e) {
    console.error('CATEGORY_BRAND_SAVE_ERROR:', e);
    res.json({ code: 500, message: 'Internal server error', data: null });
  }
});

// POST /manager/goods/categorySpec/:categoryId
router.post('/categorySpec/:category_id', async (req, res) => {
  const { category_id } = req.params;
  let categorySpecs = req.body.categorySpecs || req.query.categorySpecs;
  if (typeof categorySpecs === 'string') {
    categorySpecs = [categorySpecs];
  }
  if (!Array.isArray(categorySpecs)) {
    return res.json({ code: 400, message: 'categorySpecs must be an array', data: null });
  }
  // chuyen string specId dạng '1,2' thành mảng ['1', '2']
  categorySpecs = categorySpecs
    .flatMap(specId =>
      typeof specId === 'string' && specId.includes(',')
        ? specId.split(',')
        : [specId]
    )
    .map(id => id && id.toString().trim())
    .filter(id => id && !isNaN(Number(id)))
    .map(id => id.toString());

  try {
    await prisma.category_specification.deleteMany({ where: { category_id: category_id } });
    if (categorySpecs.length > 0) {
      await prisma.category_specification.createMany({
        data: categorySpecs.map(specId => ({
          category_id: category_id,
          specification_id: specId
        })),
        skipDuplicates: true
      });
    }
    res.json(resultSuccess());
  } catch (e) {
    console.log('CATEGORY_SPEC_SAVE_ERROR:', e);
    res.json({ code: 500, message: 'Internal server error', data: null });
  }
});

// GET /manager/goods/brand/getByPage
router.get('/brand/getByPage', async (req, res) => {
  const pageNo = parseInt(req.query.pageNumber) || 1;
  const pageSize = parseInt(req.query.pageSize) || 10;

  const where = {};
  if (req.query.name) {
    where.name = { contains: req.query.name };
  }

  try {
    const [records, total] = await Promise.all([
      prisma.brand.findMany({
        where,
        skip: (pageNo - 1) * pageSize,
        take: pageSize,
        orderBy: { id: 'asc' }
      }),
      prisma.brand.count({ where })
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

// PUT /manager/goods/brand/disable/:brandId?disable=true|false
router.put('/brand/disable/:id', async (req, res) => {
  const { id } = req.params;
  let disable = req.body.disable ?? req.query.disable;
  if (typeof disable === 'string') {
    disable = disable === 'true' || disable === '1';
  }
  if (typeof disable !== 'boolean') {
    return res.json({ code: 400, message: 'disable must be boolean', data: null });
  }

  try {
    const updated = await prisma.brand.updateMany({
      where: { id: id },
      data: { delete_flag: disable }
    });
    if (updated.count > 0) {
      res.json(resultSuccess());
    } else {
      res.json({ code: 500, message: 'BRAND_DISABLE_ERROR', data: null });
    }
  } catch (e) {
    res.json({ code: 500, message: 'BRAND_DISABLE_ERROR', data: null });
  }
});

// DELETE /manager/goods/brand/:ids
router.delete('/brand/:id', async (req, res) => {
  let id = req.params.id;
  const checkCateBrand = await prisma.category_brand.findFirst({
    where: { brand_id: id }
  })
  if( checkCateBrand ) {
    return res.json({ code: 400, message: 'BRAND_HAS_CATEGORY', data: null });
  }
  try {
    await prisma.brand.delete({
      where: { id: id }
    });
    res.json(resultSuccess());
  } catch (e) {
    console.error('BRAND_DELETE_ERROR:', e);
    res.json({ code: 500, message: 'Internal server error', data: null });
  }
});

// POST /manager/goods/brand
router.post('/brand', async (req, res) => {
  let data = req.body; 
  data.deleteFlag = !!data.deleteFlag; //string -> boolean
  try {
    data = snakecaseKeys(data);
    await prisma.brand.create({ data });
    res.json(resultData());
  } catch (e) {
    console.error('BRAND_SAVE_ERROR:', e);
    res.json({ code: 500, message: 'BRAND_SAVE_ERROR', data: null });
  }
});

// PUT /manager/goods/brand/:id
router.put('/brand/:id', async (req, res) => {
  const { id } = req.params;
  let data = req.body; 
  try {
    data = snakecaseKeys(data);
    const updated = await prisma.brand.update({
      where: { id },
      data:{
        name: data.name,
        logo: data.logo,
      }
    });
    res.json(resultData());
  } catch (e) {
    console.error('BRAND_UPDATE_ERROR:', e);
    res.json({ code: 500, message: 'BRAND_UPDATE_ERROR', data: null });
  }
});

// GET /manager/goods/spec
router.get('/spec', async (req, res) => {
  const specName = req.query.specName || '';
  const pageNo = parseInt(req.query.pageNumber) || 1;
  const pageSize = parseInt(req.query.pageSize) || 10;

  const where = {};
  if (specName && specName.trim() !== '') {
    where.spec_name = { contains: specName };
  }

  try {
    const [records, total] = await Promise.all([
      prisma.specification.findMany({
        where,
        skip: (pageNo - 1) * pageSize,
        take: pageSize,
        orderBy: { create_time: 'asc' }
      }),
      prisma.specification.count({ where })
    ]);

    // Lấy specValue cho từng specification
    const recordsWithSpecValue = await Promise.all(records.map(async (spec) => {
      const specValues = await prisma.spec_values.findMany({
        where: { spec_id: spec.id },
        orderBy: { id: 'asc' }
      });
      return {
        id: spec.id.toString(),
        specName: spec.spec_name,
        storeId: spec.store_id ? spec.store_id.toString() : null,
        specValue: specValues.map(sv => sv.spec_value).join(',')
      };
    }));

    const result = {
      records: recordsWithSpecValue,
      total,
      size: pageSize,
      current: pageNo,
      pages: Math.ceil(total / pageSize)
    };
    res.json(resultData(result));
  } catch (e) {
    res.json({ code: 500, message: 'Internal server error', data: null });
  }
});

// POST /manager/goods/spec
router.post('/spec', async (req, res) => {
  let { specName, specValue } = req.body;
  try {
    // Nếu specValue là string (dạng '1,2'), chuyển thành mảng
    if (typeof specValue === 'string') {
      specValue = specValue.split(',').map(v => v.trim()).filter(v => v !== '');
    }
    // Kiểm tra đã tồn tại specification với specName chưa
    let spec = await prisma.specification.findFirst({
      where: { spec_name: specName }
    });

    // Nếu đã có thì chỉ thêm specValue vào spec đó
    if (spec) {
      if (specValue && Array.isArray(specValue)) {
        await prisma.spec_values.createMany({
          data: specValue.map(val => ({
            spec_id: spec.id,
            spec_value: val
          })),
          skipDuplicates: true
        });
      }
      return res.json(resultSuccess());
    }

    // Nếu chưa có thì tạo mới specification và thêm specValue
    const createdSpec = await prisma.specification.create({
      data: { spec_name: specName, store_id: null }
    });
    if (specValue && Array.isArray(specValue)) {
      await prisma.spec_values.createMany({
        data: specValue.map(val => ({
          spec_id: createdSpec.id,
          spec_value: val
        })),
        skipDuplicates: true
      });
    }
    res.json(resultSuccess());
  } catch (e) {
    console.log('SPEC_SAVE_ERROR:', e);
    res.json({ code: 500, message: 'Internal server error', data: null });
  }
});

// PUT /manager/goods/spec/:id
router.put('/spec/:id', async (req, res) => {
  const { id } = req.params;
  let { specName, specValue } = req.body;
  try {
    // Cập nhật tên specification
    await prisma.specification.update({
      where: { id },
      data: { spec_name: specName }
    });
    // Nếu specValue là string (dạng '1,2'), chuyển thành mảng
    if (typeof specValue === 'string') {
      specValue = specValue.split(',').map(v => v.trim()).filter(v => v !== '');
    }
    // Nếu có mảng specValue thì:
    if (specValue && Array.isArray(specValue)) {
      // Xóa hết các spec_values cũ của spec này
      await prisma.spec_values.deleteMany({ where: { spec_id: id } });
      // Thêm mới các spec_values
      await prisma.spec_values.createMany({
        data: specValue.map(val => ({
          spec_id: id,
          spec_value: val
        })),
        skipDuplicates: true
      });
    }

    res.json(resultSuccess());
  } catch (e) {
    console.log('SPEC_UPDATE_ERROR:', e);
    res.json({ code: 500, message: 'Internal server error', data: null });
  }
});

// DELETE /manager/goods/spec/:ids
router.delete('/spec/:ids', async (req, res) => {
  let ids = req.params.ids;
  if (typeof ids === 'string') {
    ids = ids.split(',');
  }
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.json({ code: 400, message: 'ids must be a non-empty array', data: null });
  }

  try {
    const result = await prisma.specification.deleteMany({
      where: { id: { in: ids } }
    });
    res.json(resultData());
  } catch (e) {
    console.error('SPEC_DELETE_ERROR:', e);
    res.json({ code: 500, message: 'Internal server error', data: null });
  }
});

// GET /manager/goods/goodsUnit
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
    // Format create_time và update_time sang dd-mm-yyyy cho từng record
    const recordsWithFormattedDates = records.map(record => {
      let formattedCreateTime = record.create_time;
      let formattedUpdateTime = record.update_time;
      if (formattedCreateTime) {
        const date = new Date(formattedCreateTime);
        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const year = date.getFullYear();
        formattedCreateTime = `${day}-${month}-${year}`;
      }
      if (formattedUpdateTime) {
        const date = new Date(formattedUpdateTime);
        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const year = date.getFullYear();
        formattedUpdateTime = `${day}-${month}-${year}`;
      }
      return {
        ...record,
        create_time: formattedCreateTime,
        update_time: formattedUpdateTime
      };
    });
    const result = {
      records: recordsWithFormattedDates,
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

// POST /manager/goods/goodsUnit
router.post('/goodsUnit', async (req, res) => {
  const data = req.body; 
  try {
    await prisma.goods_unit.create({ data });
    res.json(resultData());
  } catch (e) {
    res.json({ code: 500, message: 'Internal server error', data: null });
  }
});

// PUT /manager/goods/goodsUnit/:id
router.put('/goodsUnit/:id', async (req, res) => {
  const { id } = req.params;
  const data = req.body; 
  try {
    const updated = await prisma.goods_unit.update({
      where: { id },
      data
    });
    res.json(resultData());
  } catch (e) {
    res.json({ code: 500, message: 'Internal server error', data: null });
  }
});

// DELETE /manager/goods/goodsUnit/delete/:ids
router.delete('/goodsUnit/delete/:ids', async (req, res) => {
  let ids = req.params.ids;
  if (typeof ids === 'string') {
    ids = ids.split(',');
  }
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.json({ code: 400, message: 'ids must be a non-empty array', data: null });
  }

  try {
    await prisma.goods_unit.deleteMany({
      where: { id: { in: ids } }
    });
    res.json(resultSuccess());
  } catch (e) {
    res.json({ code: 500, message: 'Internal server error', data: null });
  }
});

// GET /manager/goods/brand/getByPage
router.get('/brand/getByPage', async (req, res) => {
  const pageNo = parseInt(req.query.pageNumber) || 1;
  const pageSize = parseInt(req.query.pageSize) || 10;
  const where = {};
  try {
    const [records, total] = await Promise.all([
      prisma.brand.findMany({
        where,
        skip: (pageNo - 1) * pageSize,
        take: pageSize,
        orderBy: { id: 'asc' }
      }),
      prisma.brand.count({ where })
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

// GET /manager/goods/brand/getByPage
router.get('/brand/getByPage', async (req, res) => {
  const pageNo = parseInt(req.query.pageNumber) || 1;
  const pageSize = parseInt(req.query.pageSize) || 10;

  const where = {};
  if (req.query.name) {
    where.name = { contains: req.query.name };
  }
  try {
    const [records, total] = await Promise.all([
      prisma.brand.findMany({
        where,
        skip: (pageNo - 1) * pageSize,
        take: pageSize,
        orderBy: { id: 'asc' }
      }),
      prisma.brand.count({ where })
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

// PUT /manager/goods/brand/disable/:brandId?disable=true|false
router.put('/brand/disable/:brandId', async (req, res) => {
  const { brandId } = req.params;
  let disable = req.body.disable ?? req.query.disable;
  if (typeof disable === 'string') {
    disable = disable === 'true' || disable === '1';
  }
  if (typeof disable !== 'boolean') {
    return res.json({ code: 400, message: 'disable must be boolean', data: null });
  }
  try {
    const updated = await prisma.brand.update({
      where: { id: brandId },
      data: { delete_flag: disable }
    });
    if (updated.count > 0) {
      res.json(resultSuccess());
    } else {
      res.json({ code: 500, message: 'BRAND_DISABLE_ERROR', data: null });
    }
  } catch (e) {
    res.json({ code: 500, message: 'BRAND_DISABLE_ERROR', data: null });
  }
});

module.exports = router;



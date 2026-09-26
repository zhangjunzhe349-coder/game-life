/* 由 tools/build-wardrobe.py 生成，请勿手改。
   ⚠ 必须在 js/storage.js **之后**引入 —— GL 是 storage.js 建的，
     本文件是裸 `GL.WARDROBE_LIB = …`，排在前面会 ReferenceError。
   单品清单：id / name / slot(top|bottom|shoes|accessory) / cat(归一框)
             color(主体平均色，矢量立绘用) / box(主体在 512 画布里的外接框)
             img(单品的完整相对路径 —— **必须是字面量**，
                 tools/build-dist.js 靠扫字面量收集产物，拼接的路径它看不见)
   图片：assets/wardrobe/<id>.webp（512×512 透明底） */
GL.WARDROBE_LIB = [
  {
    "id": "w01",
    "name": "棕色羽绒服",
    "slot": "top",
    "cat": "top",
    "color": "#664f42",
    "box": [
      44,
      16,
      468,
      493
    ],
    "img": "assets/wardrobe/w01.webp"
  },
  {
    "id": "w02",
    "name": "卡其拼黑连帽外套",
    "slot": "top",
    "cat": "top",
    "color": "#755e4d",
    "box": [
      70,
      16,
      442,
      493
    ],
    "img": "assets/wardrobe/w02.webp"
  },
  {
    "id": "w03",
    "name": "米白印花卫衣",
    "slot": "top",
    "cat": "top",
    "color": "#c3b2a4",
    "box": [
      79,
      16,
      433,
      493
    ],
    "img": "assets/wardrobe/w03.webp"
  },
  {
    "id": "w04",
    "name": "棕灰假两件短袖",
    "slot": "top",
    "cat": "top",
    "color": "#634d47",
    "box": [
      58,
      16,
      454,
      493
    ],
    "img": "assets/wardrobe/w04.webp"
  },
  {
    "id": "w05",
    "name": "棕色长袖针织衫",
    "slot": "top",
    "cat": "top",
    "color": "#463329",
    "box": [
      60,
      16,
      451,
      493
    ],
    "img": "assets/wardrobe/w05.webp"
  },
  {
    "id": "w06",
    "name": "米白羽绒服",
    "slot": "top",
    "cat": "top",
    "color": "#847967",
    "box": [
      38,
      16,
      473,
      493
    ],
    "img": "assets/wardrobe/w06.webp"
  },
  {
    "id": "w07",
    "name": "深灰水洗牛仔裤",
    "slot": "bottom",
    "cat": "bottom",
    "color": "#3e3b38",
    "box": [
      118,
      21,
      394,
      488
    ],
    "img": "assets/wardrobe/w07.webp"
  },
  {
    "id": "w08",
    "name": "军绿白拼接棒球夹克",
    "slot": "top",
    "cat": "top",
    "color": "#777667",
    "box": [
      74,
      16,
      438,
      493
    ],
    "img": "assets/wardrobe/w08.webp"
  },
  {
    "id": "w09",
    "name": "黑色长袖衬衫",
    "slot": "top",
    "cat": "top",
    "color": "#24221f",
    "box": [
      56,
      16,
      455,
      493
    ],
    "img": "assets/wardrobe/w09.webp"
  },
  {
    "id": "w10",
    "name": "黑色印花卫衣",
    "slot": "top",
    "cat": "top",
    "color": "#302e2a",
    "box": [
      104,
      16,
      408,
      493
    ],
    "img": "assets/wardrobe/w10.webp"
  },
  {
    "id": "w11",
    "name": "米色工装夹克",
    "slot": "top",
    "cat": "top",
    "color": "#ac9d90",
    "box": [
      65,
      16,
      446,
      493
    ],
    "img": "assets/wardrobe/w11.webp"
  },
  {
    "id": "w12",
    "name": "军绿冲锋衣",
    "slot": "top",
    "cat": "top",
    "color": "#6c6a55",
    "box": [
      69,
      16,
      442,
      493
    ],
    "img": "assets/wardrobe/w12.webp"
  },
  {
    "id": "w13",
    "name": "红黑格子衬衫",
    "slot": "top",
    "cat": "top",
    "color": "#4d2321",
    "box": [
      85,
      16,
      427,
      493
    ],
    "img": "assets/wardrobe/w13.webp"
  },
  {
    "id": "w14",
    "name": "米色印花短袖",
    "slot": "top",
    "cat": "top",
    "color": "#84725c",
    "box": [
      67,
      16,
      444,
      493
    ],
    "img": "assets/wardrobe/w14.webp"
  },
  {
    "id": "w15",
    "name": "棕色短袖",
    "slot": "top",
    "cat": "top",
    "color": "#4b382c",
    "box": [
      32,
      38,
      479,
      470
    ],
    "img": "assets/wardrobe/w15.webp"
  },
  {
    "id": "w16",
    "name": "酒红印花短袖",
    "slot": "top",
    "cat": "top",
    "color": "#6f2125",
    "box": [
      51,
      16,
      461,
      493
    ],
    "img": "assets/wardrobe/w16.webp"
  },
  {
    "id": "w17",
    "name": "墨绿印花短袖",
    "slot": "top",
    "cat": "top",
    "color": "#313f32",
    "box": [
      42,
      16,
      469,
      493
    ],
    "img": "assets/wardrobe/w17.webp"
  },
  {
    "id": "w18",
    "name": "黑色短袖",
    "slot": "top",
    "cat": "top",
    "color": "#282724",
    "box": [
      77,
      16,
      436,
      492
    ],
    "img": "assets/wardrobe/w18.webp"
  },
  {
    "id": "w19",
    "name": "卡其工装裤",
    "slot": "bottom",
    "cat": "bottom",
    "color": "#705f52",
    "box": [
      128,
      21,
      383,
      488
    ],
    "img": "assets/wardrobe/w19.webp"
  },
  {
    "id": "w20",
    "name": "黑色长袖上衣",
    "slot": "top",
    "cat": "top",
    "color": "#242322",
    "box": [
      87,
      16,
      424,
      493
    ],
    "img": "assets/wardrobe/w20.webp"
  },
  {
    "id": "w21",
    "name": "棕色休闲裤",
    "slot": "bottom",
    "cat": "bottom",
    "color": "#645243",
    "box": [
      85,
      21,
      426,
      488
    ],
    "img": "assets/wardrobe/w21.webp"
  },
  {
    "id": "w22",
    "name": "黑色短裤",
    "slot": "bottom",
    "cat": "bottom",
    "color": "#171717",
    "box": [
      128,
      22,
      384,
      487
    ],
    "img": "assets/wardrobe/w22.webp"
  },
  {
    "id": "w23",
    "name": "浅色水洗牛仔裤",
    "slot": "bottom",
    "cat": "bottom",
    "color": "#7f807c",
    "box": [
      106,
      21,
      406,
      488
    ],
    "img": "assets/wardrobe/w23.webp"
  },
  {
    "id": "w24",
    "name": "黑色夹克",
    "slot": "top",
    "cat": "top",
    "color": "#272522",
    "box": [
      77,
      16,
      435,
      493
    ],
    "img": "assets/wardrobe/w24.webp"
  },
  {
    "id": "w25",
    "name": "黑色印花短袖",
    "slot": "top",
    "cat": "top",
    "color": "#413c47",
    "box": [
      87,
      16,
      424,
      493
    ],
    "img": "assets/wardrobe/w25.webp"
  },
  {
    "id": "w26",
    "name": "灰色运动裤",
    "slot": "bottom",
    "cat": "bottom",
    "color": "#828380",
    "box": [
      134,
      21,
      377,
      489
    ],
    "img": "assets/wardrobe/w26.webp"
  },
  {
    "id": "w27",
    "name": "宝蓝短袖",
    "slot": "top",
    "cat": "top",
    "color": "#1c4c9a",
    "box": [
      64,
      16,
      447,
      493
    ],
    "img": "assets/wardrobe/w27.webp"
  },
  {
    "id": "w28",
    "name": "深色水洗牛仔裤",
    "slot": "bottom",
    "cat": "bottom",
    "color": "#555565",
    "box": [
      127,
      20,
      385,
      489
    ],
    "img": "assets/wardrobe/w28.webp"
  },
  {
    "id": "w29",
    "name": "浅蓝拼接外套",
    "slot": "top",
    "cat": "top",
    "color": "#abb1bd",
    "box": [
      85,
      16,
      427,
      493
    ],
    "img": "assets/wardrobe/w29.webp"
  },
  {
    "id": "w30",
    "name": "军绿短袖",
    "slot": "top",
    "cat": "top",
    "color": "#505a52",
    "box": [
      94,
      16,
      418,
      493
    ],
    "img": "assets/wardrobe/w30.webp"
  },
  {
    "id": "w31",
    "name": "米白拉链外套",
    "slot": "top",
    "cat": "top",
    "color": "#a69d99",
    "box": [
      96,
      16,
      415,
      493
    ],
    "img": "assets/wardrobe/w31.webp"
  },
  {
    "id": "w32",
    "name": "灰色工装裤",
    "slot": "bottom",
    "cat": "bottom",
    "color": "#76757a",
    "box": [
      91,
      20,
      421,
      489
    ],
    "img": "assets/wardrobe/w32.webp"
  },
  {
    "id": "w33",
    "name": "红色双肩包",
    "slot": "accessory",
    "cat": "bag",
    "color": "#be223c",
    "box": [
      128,
      31,
      384,
      478
    ],
    "img": "assets/wardrobe/w33.webp"
  },
  {
    "id": "w34",
    "name": "军绿双肩包",
    "slot": "accessory",
    "cat": "bag",
    "color": "#616154",
    "box": [
      146,
      31,
      364,
      480
    ],
    "img": "assets/wardrobe/w34.webp"
  },
  {
    "id": "w35",
    "name": "黑色斜挎包",
    "slot": "accessory",
    "cat": "bag",
    "color": "#363036",
    "box": [
      101,
      30,
      412,
      480
    ],
    "img": "assets/wardrobe/w35.webp"
  },
  {
    "id": "w36",
    "name": "墨镜",
    "slot": "accessory",
    "cat": "glass",
    "color": "#18161a",
    "box": [
      28,
      157,
      483,
      341
    ],
    "img": "assets/wardrobe/w36.webp"
  },
  {
    "id": "w37",
    "name": "米白洞洞鞋",
    "slot": "shoes",
    "cat": "shoes",
    "color": "#c9c4b6",
    "box": [
      32,
      156,
      479,
      342
    ],
    "img": "assets/wardrobe/w37.webp"
  },
  {
    "id": "w38",
    "name": "白黑运动鞋",
    "slot": "shoes",
    "cat": "shoes",
    "color": "#b3ada5",
    "box": [
      33,
      161,
      478,
      336
    ],
    "img": "assets/wardrobe/w38.webp"
  },
  {
    "id": "w39",
    "name": "黑色休闲鞋",
    "slot": "shoes",
    "cat": "shoes",
    "color": "#252625",
    "box": [
      33,
      150,
      478,
      349
    ],
    "img": "assets/wardrobe/w39.webp"
  },
  {
    "id": "w40",
    "name": "黑白帆布鞋",
    "slot": "shoes",
    "cat": "shoes",
    "color": "#918b80",
    "box": [
      33,
      159,
      478,
      338
    ],
    "img": "assets/wardrobe/w40.webp"
  },
  {
    "id": "w41",
    "name": "灰白跑鞋",
    "slot": "shoes",
    "cat": "shoes",
    "color": "#a7adb0",
    "box": [
      33,
      151,
      478,
      347
    ],
    "img": "assets/wardrobe/w41.webp"
  }
];

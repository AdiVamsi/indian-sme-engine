const express = require("express");
const router = express.Router();
const controller = require("../controllers/services.controller");

router.post("/", controller.create);
router.get("/", controller.list);
router.patch("/:id", controller.update);
router.delete("/:id", controller.remove);

module.exports = router;
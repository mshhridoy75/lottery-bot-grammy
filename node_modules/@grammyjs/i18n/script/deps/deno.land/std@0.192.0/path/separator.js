"use strict";
// Copyright 2018-2023 the Deno authors. All rights reserved. MIT license.
// This module is browser compatible.
Object.defineProperty(exports, "__esModule", { value: true });
exports.SEP_PATTERN = exports.SEP = void 0;
const os_js_1 = require("../_util/os.js");
exports.SEP = os_js_1.isWindows ? "\\" : "/";
exports.SEP_PATTERN = os_js_1.isWindows ? /[\\/]+/ : /\/+/;

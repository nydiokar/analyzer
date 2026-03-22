"use strict";
/**
 * KOL Import Script
 *
 * Reads .ai/context/KOL_proj/kol_top_470_cleaned.json and upserts:
 *   1. Wallet row with knownType='KOL' and knownLabel=name
 *   2. KolProfile row with name, twitter, telegram
 *
 * No analysis is triggered. Safe to run multiple times (idempotent).
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register src/scripts/import-kols.ts
 *   -- or --
 *   pnpm tsx src/scripts/import-kols.ts
 */
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
var fs = require("fs");
var path = require("path");
var client_1 = require("@prisma/client");
function main() {
    return __awaiter(this, void 0, void 0, function () {
        var filePath, raw, parsed, entries, prisma, walletUpserted, kolUpserted, skipped, _i, entries_1, entry, wallet_address, name_1, twitter, telegram;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    filePath = path.resolve(process.cwd(), '.ai/context/KOL_proj/kol_top_470_cleaned.json');
                    if (!fs.existsSync(filePath)) {
                        console.error("File not found: ".concat(filePath));
                        process.exit(1);
                    }
                    raw = fs.readFileSync(filePath, 'utf-8');
                    parsed = JSON.parse(raw);
                    entries = parsed.data;
                    console.log("Loaded ".concat(entries.length, " KOL entries from file"));
                    prisma = new client_1.PrismaClient();
                    walletUpserted = 0;
                    kolUpserted = 0;
                    skipped = 0;
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, , 6, 8]);
                    _i = 0, entries_1 = entries;
                    _a.label = 2;
                case 2:
                    if (!(_i < entries_1.length)) return [3 /*break*/, 5];
                    entry = entries_1[_i];
                    wallet_address = entry.wallet_address, name_1 = entry.name, twitter = entry.twitter, telegram = entry.telegram;
                    if (!wallet_address || !name_1) {
                        console.warn("Skipping entry with missing wallet_address or name:", entry);
                        skipped++;
                        return [3 /*break*/, 4];
                    }
                    // Both upserts in a single transaction — avoids partial state if interrupted
                    return [4 /*yield*/, prisma.$transaction([
                            // 1. Upsert Wallet row — knownType='KOL', knownLabel=name
                            //    Do NOT set classification='SYSTEM' — KOLs are analyzed normally.
                            prisma.wallet.upsert({
                                where: { address: wallet_address },
                                create: {
                                    address: wallet_address,
                                    knownType: 'KOL',
                                    knownLabel: name_1,
                                    classification: 'unknown',
                                },
                                update: {
                                    knownType: 'KOL',
                                    knownLabel: name_1,
                                    // Preserve existing classification (may have analysis data from before)
                                },
                            }),
                            // 2. Upsert KolProfile row
                            prisma.kolProfile.upsert({
                                where: { walletAddress: wallet_address },
                                create: {
                                    walletAddress: wallet_address,
                                    name: name_1,
                                    twitter: twitter !== null && twitter !== void 0 ? twitter : null,
                                    telegram: telegram !== null && telegram !== void 0 ? telegram : null,
                                },
                                update: {
                                    name: name_1,
                                    twitter: twitter !== null && twitter !== void 0 ? twitter : null,
                                    telegram: telegram !== null && telegram !== void 0 ? telegram : null,
                                },
                            }),
                        ])];
                case 3:
                    // Both upserts in a single transaction — avoids partial state if interrupted
                    _a.sent();
                    walletUpserted++;
                    kolUpserted++;
                    if (kolUpserted % 50 === 0) {
                        console.log("  Progress: ".concat(kolUpserted, "/").concat(entries.length));
                    }
                    _a.label = 4;
                case 4:
                    _i++;
                    return [3 /*break*/, 2];
                case 5: return [3 /*break*/, 8];
                case 6: return [4 /*yield*/, prisma.$disconnect()];
                case 7:
                    _a.sent();
                    return [7 /*endfinally*/];
                case 8:
                    console.log('\n=== Import complete ===');
                    console.log("  Wallet rows upserted : ".concat(walletUpserted));
                    console.log("  KolProfile rows      : ".concat(kolUpserted));
                    console.log("  Skipped              : ".concat(skipped));
                    console.log('\nKOL wallets are tagged with knownType=KOL and will be:');
                    console.log('  - Analyzed normally (NOT skipped by any pipeline)');
                    console.log('  - Labelled with their real name in all API responses');
                    console.log('  - Synced via helius-sync-service like any other trader');
                    return [2 /*return*/];
            }
        });
    });
}
main().catch(function (err) {
    console.error('Import failed:', err);
    process.exit(1);
});

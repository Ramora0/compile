/**
 * Card registry bootstrap. Importing this module triggers `registerCard()`
 * calls for all 15 protocols × 6 cards = 90 cards.
 *
 * The server entry imports this once at startup; tests typically don't
 * (they install mock cards via clearRegistry + registerCard).
 */

import "./apathy.js";
import "./darkness.js";
import "./death.js";
import "./fire.js";
import "./gravity.js";
import "./hate.js";
import "./life.js";
import "./light.js";
import "./love.js";
import "./metal.js";
import "./plague.js";
import "./psychic.js";
import "./speed.js";
import "./spirit.js";
import "./water.js";

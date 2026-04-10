import {
  entries,
  aliases,
  skinIdsToCodes,
} from "./emoji-data.js";
import { slackAliases } from "./slack-emoji-data.js";

let nameToCode = null;

function getNameToCode() {
  if (nameToCode === null) {
    nameToCode = Object.assign({}, slackAliases, aliases);
    for (let i = 0, len = entries.length; i < len; i++) {
      nameToCode[entries[i][0]] = entries[i][1];
    }
  }
  return nameToCode;
}

function textFromCode(code) {
  if (!code) {
    return "";
  }

  const codePoints = code.split("-").map((v) => parseInt(v, 16)),
    text = String.fromCodePoint.apply(String, codePoints);

  return text;
}

export { getNameToCode, textFromCode, skinIdsToCodes };

import { aliases, entries, skinTones } from "./emoji-data.js";
import { slackAliases } from "./slack-emoji-data.js";

let nameToEmoji = null;

function getNameToEmoji() {
  if (nameToEmoji === null) {
    nameToEmoji = Object.assign({}, slackAliases, aliases);
    for (let i = 0, len = entries.length; i < len; i++) {
      nameToEmoji[entries[i][0]] = entries[i][1];
    }
  }
  return nameToEmoji;
}

function textFromCode(code) {
  if (!code) {
    return "";
  }

  const codePoints = code.split("-").map((v) => parseInt(v, 16)),
    text = String.fromCodePoint.apply(String, codePoints);

  return text;
}

export { getNameToEmoji, skinTones, textFromCode };

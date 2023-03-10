import { google } from "googleapis";
import { GoogleAuth } from "google-auth-library";
import { JSONClient } from "google-auth-library/build/src/auth/googleauth";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let githubNames: any[]; // [index, github account name]
let nameList: string[]; // [github account name]
let memberRows: any[];  // [slack id url, github account url]

async function mentionAuthor(operateRow, has_product_effect) {
  let slackID = await convertPRauthor2slackName(operateRow[3]);
  const postUrl = process.env["SLACK_POST_URL"];
  if (slackID == -1) {
    const approvers = operateRow[4].split('\n');
    for (const approver of approvers) {
      const approverSlackID = await convertPRauthor2slackName(approver);
      if (approverSlackID != -1) {
        slackID = approverSlackID;
        console.log("Mention PR approver:", approver);
        break;
      }
    }
    if (slackID == -1) {
      slackID = "S03FPJ8THLH"; // org-eng-si ID
      console.log("Mention org-eng-si");
    }
  }
  if (slackID != -1) {
    const url = operateRow[2].match(/"(.*?)"/)[1];
    let mention: any;
    if (has_product_effect) {
      mention = {
        text:
          "<@" +
          slackID +
          "> Please write \"Topic changes\" and \"Product efffects\" for <" +
          url +  "|" + operateRow[1] + "> at N" + 
          operateRow[0] + ":O" + operateRow[0] + ".",
      };
    }
    else {
      mention = {
        text:
          "<@" +
          slackID +
          "> Please write \"Test performed\" for <" +
          url +  "|" + operateRow[1] + "> at H" + 
          operateRow[0] + " since the PR is Feature or Bug fix.",
      };
    }
    const mentionPayload = JSON.stringify(mention);
    const response = await fetch(postUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: mentionPayload,
    });
    console.log("slack post response: ", response.status);
    console.log("Mentioned PR author:", operateRow[3]);
  }
  else {
    console.log("No PR author found");
  }
}

function convertPRauthor2slackName(author) {
  // index: author index of nameList
  const authorIndex = nameList.indexOf(author);

  // If the author doesn't find in the nameList
  if (authorIndex == -1) {
    return Promise.resolve(-1);
  }
  const slackUrl = memberRows[githubNames[authorIndex][0]][0];
  const slackID = slackUrl.split("/")[4];
  return Promise.resolve(slackID);
}

async function getMember(auth: GoogleAuth<JSONClient>) {
  const authClient = await auth.getClient();
  const sheets = google.sheets({ version: "v4", auth: authClient });
  try {
    const memberSpreadsheetId = process.env["MEMBER_SPREADSHEET_ID"];
    const sheetName = "EmployeeList_HRBrain";
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: memberSpreadsheetId,
      range: `${sheetName}!V2:W`,
    });
    memberRows = res.data.values;
    if (memberRows && memberRows.length) {
      // stringRows: [index, github_account_url]
      const stringRows: any[] = memberRows
        .map((row, idx) => {
          return [idx, row[1]];
        })
        .filter((value) => value[1] != undefined);
      githubNames = stringRows.map((url) => {
        return [url[0], url[1].split("/")[6]];
      });
      nameList = githubNames.map((name) => {
        return name[1];
      });
      console.log("Get member from spread sheet.")
    } else {
      console.log("No data found.");
    }
  } catch (err) {
    console.log("The API returned an error: " + err);
    process.exit(1);
  }
}

async function main(auth: GoogleAuth<JSONClient>) {
  const authClient = await auth.getClient();
  const isGetMember = await getMember(auth);

  const sheets = google.sheets({ version: "v4", auth: authClient });
  try {
    const releaseSpreadsheetId = process.env["RELEASE_SPREADSHEET_ID"];
    const sheetName = process.env["SHEET_NAME"];

    // Get PR id data from spread sheets
    const { data } = await sheets.spreadsheets.values.get({
      spreadsheetId: releaseSpreadsheetId,
      range: `${sheetName}!A2:O`,
      valueRenderOption: "FORMULA",
    });
    // mention the forgetful author
    let isMentioned = false;
    for (const row of data.values) {
      if (
        (row[13] == undefined && row[14] == undefined) &&
        (row[6] != "UNDEFINED" || 
        row[7] != "UNDEFINED" || 
        row[8] != "UNDEFINED" ||
        row[1].toLowerCase().includes("change topic") ||
        row[1].toLowerCase().includes("topic change") ||
        row[1].toLowerCase().includes("remove") ||
        row[5].toLowerCase().includes("change topic") ||
        row[5].toLowerCase().includes("topic change") ||
        row[5].toLowerCase().includes("remove"))
      ) {
        const has_product_effect = true;
        mentionAuthor(row, has_product_effect);
        isMentioned = true;
        await sleep(1000);
      } else if (
        (row[9] == "Features" && row[7] == "UNDEFINED") ||
        (row[9] == "Bug Fixes" && row[7] == "UNDEFINED")
      ) {
        const has_product_effect = false;
        mentionAuthor(row, has_product_effect);
        isMentioned = true;
        await sleep(1000);
      }
    }
    if (!isMentioned) {
      console.log("All authors or approvers who have to write addional comment on the release notes have finished writing")
    }
  } catch (err) {
    console.log("The API returned an error: " + err);
    process.exit(1);
  }
}

const auth = new google.auth.GoogleAuth({
  scopes: SCOPES,
});

main(auth);

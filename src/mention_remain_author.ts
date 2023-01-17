import { google } from "googleapis";
import { GoogleAuth } from "google-auth-library";
import { JSONClient } from "google-auth-library/build/src/auth/googleauth";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];

let githubNames: any[]; // [index, github account name]
let nameList: string[]; // [github account name]
let memberRows: any[];  // [slack id url, github account url]

async function mentionAuthor(operateRow) {
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
    const mention = {
      text:
        "<@" +
        slackID +
        "> Please write \"Topic changes\" and \"Product efffects\" for <" +
        operateRow[2] +  "|" + operateRow[1] + "> at N" + 
        operateRow[0] + ":O" + operateRow[0] + ".",
    };
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
  getMember(auth);

  const sheets = google.sheets({ version: "v4", auth: authClient });
  try {
    const releaseSpreadsheetId = process.env["RELEASE_SPREADSHEET_ID"];
    const sheetName = "AWFPR";

    // Get PR id data from spread sheets
    const { data } = await sheets.spreadsheets.values.get({
      spreadsheetId: releaseSpreadsheetId,
      range: `${sheetName}!A2:O`,
    });
    for (const row of data.values) {
      if (
        (row[6] != "UNDEFINED" || 
        row[7] != "UNDEFINED" || 
        row[8] != "UNDEFINED") &&
        (row[13] == "" && row[14] == "") ||
        row[1].toLowerCase().includes("change topic") ||
        row[1].toLowerCase().includes("topic change") ||
        row[1].toLowerCase().includes("remove") ||
        row[5].toLowerCase().includes("change topic") ||
        row[5].toLowerCase().includes("topic change") ||
        row[5].toLowerCase().includes("remove")
      ) {       
        mentionAuthor(row);
      }
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

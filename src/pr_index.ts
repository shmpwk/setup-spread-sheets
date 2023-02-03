import { google } from "googleapis";
import { GoogleAuth } from "google-auth-library";
import { JSONClient } from "google-auth-library/build/src/auth/googleauth";
import { Readable } from "stream";
import * as fs from 'fs';

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];
const DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive"];

interface PrContents {
  [key: string]: any;
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let githubNames: any[]; // [index, github account name]
let nameList: string[]; // [github account name]
let memberRows: any[];  // [slack id url, github account url]

async function getFile() {
  const drive = new google.auth.GoogleAuth({
    scopes: DRIVE_SCOPES,
  });
  const authClient = await drive.getClient();
  const driveService = google.drive({version: 'v3', auth: authClient});
  
  const fileId = process.env["FILE_ID"];
  return new Promise((resolve, reject) => {
    driveService.files.get({fileId, alt: 'media'}, {responseType: 'stream'},
      (err, res) => {
        if (err) return console.log(err);
        const stream = res.data as Readable;
        stream.setEncoding('utf8');
        let prData = "";
        stream.on("data", chunk => prData += chunk);
        stream.on("end", () => {
          try {
            let prContents: PrContents = JSON.parse(prData);
            resolve(prContents);
          } catch (e) {
            reject(e);
          }
        });
    });
  });
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

async function mentionAuthor(pr, operateRow, has_product_effect) {
  let slackID = await convertPRauthor2slackName(pr.author);
  const postUrl = process.env["SLACK_POST_URL"];
  if (slackID == -1) {
    const approvers = pr.approver.split('\n');
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
    let mention: any;
    if (has_product_effect) {
      mention = {
        text:
          "<@" +
          slackID +
          "> Please write \"Topic changes\" and \"Product efffects\" for <" +
          pr.url +  "|" + pr.title + "> at N" + 
          operateRow + ":O" + operateRow + ".",
      };
    }
    else {
      mention = {
        text:
          "<@" +
          slackID +
          "> Please write \"Test performed\" for <" +
          pr.url +  "|" + pr.title + "> at H" + 
          operateRow + " since the PR is Feature or Bug fix.",
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
    console.log("Mentioned PR author:", pr.author);
  }
  else {
    console.log("No PR author found");
  }
}

async function main(auth: GoogleAuth<JSONClient>) {
  const authClient = await auth.getClient();
  getMember(auth);

  const sheets = google.sheets({ version: "v4", auth: authClient });
  try {
    const releaseSpreadsheetId = process.env["RELEASE_SPREADSHEET_ID"];
    // const prContents = JSON.parse(process.env["PR_CONTENTS"]!);
    const prContents: PrContents = await getFile();
    const enableOverwrite = process.env["ENABLE_OVERWRITE"];
    const sheetName = process.env["SHEET_NAME"];
    let prContentsArray = Object.keys(prContents).map(k => prContents[k]);

    for (const pr of prContentsArray) {
      console.log("PR: ", pr);
      const description = pr.description.replace(/\\n/g, '\n');

      const values: any[] = Array(
        pr.title,
        `=HYPERLINK("${pr.url}", "#"&"${pr.url.split("/").slice(-1)[0]}")`,
        pr.author,
        pr.approver,
        description,
        pr.related_links,
        pr.test_performed,
        pr.note_for_reviewers,
        pr.type,
        pr.scope,
        pr.labels,
        pr.id
      );

      // Get PR id data from spread sheets
      const { data } = await sheets.spreadsheets.values.get({
        spreadsheetId: releaseSpreadsheetId,
        range: `${sheetName}!M2:M`,
      });
      let numIdRows: number;
      let prIndex: number;
      const allValues = data.values;
      if (!allValues || !allValues[0]) {
        numIdRows = 0;
        prIndex = -1;
      } else {
        const idValues = allValues.flat();
        numIdRows = allValues.length;
        prIndex = idValues.findIndex((id) => id === pr.id);
      }

      // If the PR is new, add it to spread sheet
      let operateRow = -1;
      if (prIndex === -1) {
        operateRow = numIdRows + 1;
        values.unshift(operateRow); // Add row number. +1 means header.
        const addRequest = {
          spreadsheetId: releaseSpreadsheetId,
          range: `${sheetName}!A2:M`,
          valueInputOption: "USER_ENTERED",
          insertDataOption: "INSERT_ROWS",
          resource: {
            majorDimension: "ROWS",
            values: [values],
          },
          auth: authClient,
        };
        await sheets.spreadsheets.values.append(addRequest);
        await sleep(1000);

        // If the author choose standard template PR, 
        // or use "change topic", "topic change" or "remove"
        // or it is feature or Bug fix PR, 
        // mention the author on slack.
        if (
          pr.related_links != "UNDEFINED" ||
          pr.test_performed != "UNDEFINED" ||
          pr.note_for_reviewers != "UNDEFINED" ||
          pr.title.toLowerCase().includes("change topic") ||
          pr.title.toLowerCase().includes("topic change") ||
          pr.title.toLowerCase().includes("remove") ||
          pr.description.toLowerCase().includes("change topic") ||
          pr.description.toLowerCase().includes("topic change") ||
          pr.description.toLowerCase().includes("remove")
        ) {
          const has_product_effect = true;
          mentionAuthor(pr, operateRow, has_product_effect);
          console.log("The author chose standard PR template so we mention the author.");
        } else if (
          (pr.type == "Features" && pr.test_performed == "UNDEFINED") ||
          (pr.type == "Bug Fixes" && pr.test_performed == "UNDEFINED")
        ) {
          const has_product_effect = false;
          mentionAuthor(pr, operateRow, has_product_effect);
          console.log("The author did not write test performed though the PR is feature or bug fix so we mention the author.");
        } else {
          console.log("The author chose small PR template so we do not mention the author.");
        }
      } else if (enableOverwrite) {
        // If the PR is already written, update the contents
        console.log("Overwrite spread sheets. Not mention author");
        operateRow = prIndex + 1;
        values.unshift(operateRow); // Add row number. +1 means header.
        const updateRequest = {
          spreadsheetId: releaseSpreadsheetId,
          range: `${sheetName}!A${prIndex + 2}:${String.fromCharCode(
            65 + values.length
          )}${prIndex + 2}`,
          valueInputOption: "USER_ENTERED",
          resource: {
            majorDimension: "ROWS",
            values: [values],
          },
          auth: authClient,
        };
        await sheets.spreadsheets.values.update(updateRequest);
        await sleep(1000);
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

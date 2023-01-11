import { google } from "googleapis";
import { GoogleAuth } from "google-auth-library";
import { JSONClient } from "google-auth-library/build/src/auth/googleauth";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function convertPRauthor2slackName(auth: GoogleAuth<JSONClient>, author) {
  const authClient = await auth.getClient();
  const sheets = google.sheets({ version: "v4", auth: authClient });
  try {
    const memberSpreadsheetId = process.env["MEMBER_SPREADSHEET_ID"];
    const sheetName = "EmployeeList_HRBrain";
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: memberSpreadsheetId,
      range: `${sheetName}!V2:W`,
    });
    const rows = res.data.values;
    if (rows && rows.length) {
      // stringRows: [index, github_account_url]
      const stringRows = rows
        .map((row, idx) => {
          return [idx, row[1]];
        })
        .filter((value) => value[1] != undefined);
      // githubNames: [index, github_account_name]
      const githubNames = stringRows.map((url) => {
        return [url[0], url[1].split("/")[6]];
      });
      // nameList: [github_account_name]
      const nameList = githubNames.map((name) => {
        return name[1];
      });
      // index: author index of nameList
      const authorIndex = nameList.indexOf(author);

      // If the author doesn't find in the nameList
      if (authorIndex == -1) {
        return Promise.resolve(-1);
      }
      const slackUrl = rows[githubNames[authorIndex][0]][0];
      const slackID = slackUrl.split("/")[4];
      return Promise.resolve(slackID);
    } else {
      console.log("No data found.");
    }
  } catch (err) {
    console.log("The API returned an error: " + err);
    process.exit(1);
  }
}

async function mentionAuthor(auth, pr, operateRow) {
  let slackID = await convertPRauthor2slackName(auth, pr.author);
  const postUrl = process.env["SLACK_POST_URL"];
  if (slackID == -1) {
    for (const approver of pr.approver) {
      const approverSlackID = await convertPRauthor2slackName(auth, approver);
      if (approverSlackID != -1) {
        slackID = approverSlackID;
        console.log("Mention ", approver);
        break;
      }
    }
    if (slackID == -1) {
      slackID = "U01TCCBQTJL"; // shmpwk ID, This should be replaced with org-eng-si
      console.log("Mention shmpwk");
    }
  }
  if (slackID != -1) {
    const mention = {
      text:
        "<@" +
        slackID +
        "> Please write \"Topic changes\" and \"Product efffects\" for <" +
        pr.url +  "|" + pr.title + "> at N" + 
        operateRow + ":O" + operateRow + ".",
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
    console.log("Mentioned PR author on slack");
  }
  else {
    console.log("No PR author found");
  }
}

async function main(auth: GoogleAuth<JSONClient>) {
  const authClient = await auth.getClient();

  const sheets = google.sheets({ version: "v4", auth: authClient });
  try {
    const releaseSpreadsheetId = process.env["RELEASE_SPREADSHEET_ID"];
    const prContents = JSON.parse(process.env["PR_CONTENTS"]!);
    const enableOverwrite = process.env["ENABLE_OVERWRITE"];
    const sheetName = process.env["SHEET_NAME"];

    for (const pr of prContents) {
      console.log("PR: ", pr);
      const description = pr.description.replace(/\\n/g, '\n');

      const values = Array(
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

        // If the author choose standard template PR, mention the author on slack.
        if (
          pr.related_links != "UNDEFINED" ||
          pr.test_performed != "UNDEFINED" ||
          pr.note_for_reviewers != "UNDEFINED"
        ) {
          mentionAuthor(auth, pr, operateRow);
          console.log("The author chose standard PR template so we mention the author.");
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

import { google } from "googleapis";
import { GoogleAuth } from "google-auth-library";
import { JSONClient } from "google-auth-library/build/src/auth/googleauth";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];

async function convertPRauthor2slackName(auth: GoogleAuth<JSONClient>, author) {
  // read https://docs.google.com/spreadsheets/d/1RtWwL4Fh4ldT8NDtsk2kXugdudN64iRvwt2a7Dp0jGU/edit#gid=0
  const authClient = await auth.getClient();

  const sheets = google.sheets({ version: "v4", auth: authClient });
  try {
    // const spreadsheetId = "1SSO0Z6MYuNMsS63BDSVJhN_wB-oIdABbtmn8u3pPkNs";
    const spreadsheetId = "1gBV2yT3XjtPKhZ1UZC-_q7ShdAn3bKxd5U3kIiqE5m4";
    const sheetName = "EmployeeList_HRBrain";
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!V2:W`,
    });
    const rows = res.data.values;
    if (rows && rows.length) {
      const stringRows = rows
        .map((row, idx) => {
          return [idx, row[1]];
        })
        .filter((value) => value[1] != undefined);
      // [index, github_name]
      const githubNames = stringRows.map((url) => {
        return [url[0], url[1].split("/")[6]];
      });
      // [github_name]
      const nameList = githubNames.map((name) => {
        return name[1];
      });
      const index = nameList.indexOf(author);
      if (index == -1) {
        return Promise.resolve(-1);
      }
      const slackNames = rows.map((row) => {
        return row;
      });
      const slackUrl = slackNames[githubNames[index][0]][0];
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

async function mentionAuthor(auth, pr) {
  const slackID = await convertPRauthor2slackName(auth, pr.author);
  const postUrl =
    "https://hooks.slack.com/services/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";
  if (slackID != -1) {
    const mention = {
      text:
        "<@" +
        slackID +
        "> Please add explanation about Product efffect for " +
        pr.title,
    };
    const mentionPayload = JSON.stringify(mention);
    const response = await fetch(postUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: mentionPayload,
    });
  }
}

async function main(auth: GoogleAuth<JSONClient>) {
  const authClient = await auth.getClient();

  const sheets = google.sheets({ version: "v4", auth: authClient });
  try {
    const spreadsheetId = process.env["SPREADSHEET_ID"];
    const prContents = JSON.parse(process.env["PR_CONTENTS"]!);
    const sheetName = "AWFPR";

    let pr: any;
    for (pr of prContents) {
      console.log(pr);
      let values = Array(
        pr.title,
        `=HYPERLINK("${pr.url}", "#"&"${pr.url.split("/").slice(-1)[0]}")`,
        pr.author,
        pr.description,
        pr.related_links,
        pr.test_performed,
        pr.note_for_reviewers,
        pr.type,
        pr.scope,
        pr.labels,
        pr.id
      );

      let request = {
        spreadsheetId,
        range: `${sheetName}!A2:L`,
        valueInputOption: "USER_ENTERED",
        insertDataOption: "INSERT_ROWS",
        resource: {
          majorDimension: "ROWS",
          values: [values],
        },
        auth: authClient,
      };
      const sheet = (
        await sheets.spreadsheets.get({
          spreadsheetId,
        })
      ).data.sheets.find((s) => s.properties.title === sheetName);

      // const numRows = sheet.properties.gridproperties.rowCount;

      const { data } = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${sheetName}!L2:L`,
      });
      const idValues = data.values.flat();
      const numRows = data.values.length;
      const index = idValues.findIndex((id) => id === pr.id);
      if (index === -1) {
        values.unshift(numRows + 1); // header
        await sheets.spreadsheets.values.append(request);
      } else {
        values.unshift(index + 1); // header
        let request2 = {
          spreadsheetId,
          // range: `${sheetName}!A${index + 2}:${google.utils.encodeColumnName(
          //   values.length
          // )}${index + 2}`,
          range: `${sheetName}!A${index + 2}:${String.fromCharCode(
            65 + values.length - 1
          )}${index + 2}`,
          valueInputOption: "USER_ENTERED",
          resource: {
            majorDimension: "ROWS",
            values: [values],
          },
          auth: authClient,
        };
        await sheets.spreadsheets.values.update(request2);
      }

      // If the author choose standard template PR
      if (
        pr.related_links != "UNDEFINED" ||
        pr.test_performed != "UNDEFINED" ||
        pr.note_for_reviewers != "UNDEFINED"
      ) {
        // mention author on slack
        mentionAuthor(auth, pr);
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

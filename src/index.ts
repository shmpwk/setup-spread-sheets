import { google } from "googleapis";
import { GoogleAuth } from "google-auth-library";
import { JSONClient } from "google-auth-library/build/src/auth/googleauth";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];
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
      let content = [
        pr.id,
        pr.type,
        pr.scope,
        pr.labels,
        pr.title,
        `=HYPERLINK("${pr.url}", "#"&"${pr.url.split('/').slice(-1)[0]}")`,
        pr.author,
        pr.description,
        pr.related_links,
        pr.test_performed,
        pr.note_for_reviewers,
      ];

      let request = {
        spreadsheetId,
        range: `${sheetName}!A2:L`,
        valueInputOption: "USER_ENTERED",
        insertDataOption: "INSERT_ROWS",
        resource: {
          majorDimension: "ROWS",
          values: content,
        },
        auth: authClient,
      };
      await sheets.spreadsheets.values.append(request);
    };

  } catch (err) {
    console.log("The API returned an error: " + err);
    process.exit(1);
  }
}

const auth = new google.auth.GoogleAuth({
  scopes: SCOPES,
});

main(auth);

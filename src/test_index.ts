function getAccessToken() { 
  //  compose access token
  const now = new Date().getTime().toString();
  const timeNonce = now.substr(now.length-3);
  const jwtHeader: any = {
        "alg":"RS256","typ":"JWT"
      };
  const jwtClaimSet: any = {
        "iss":"spread-sheets-release-note@tier-iv-engineering-div-common.iam.gserviceaccount.com",
        "sub":"shumpei.wakabayashi@tier4.jp",
        "scope":  "https://www.googleapis.com/auth/spreadsheets",
        "aud":"https://oauth2.googleapis.com/token",
        "exp":timeNonce+3600,
        "iat":timeNonce
      };
  const jwtCertificate =  this.CERTIFICATE;
  const jwtWillBeSigned = Utilities.base64Encode(JSON.stringify(jwtHeader))
                      + "."
                      + Utilities.base64Encode(JSON.stringify(jwtClaimSet));
  const jwtSignature  = Utilities.base64Encode(Utilities.computeRsaSha256Signature(jwtWillBeSigned,jwtCertificate));
  const jwtAssertion  = jwtWillBeSigned+"."+jwtSignature;
  const payload = 'grant_type='
                + 'urn:ietf:params:oauth:grant-type:jwt-bearer'
                + '&'
                + 'assertion='
                + encodeURIComponent(jwtAssertion);
  const options = {
    "method" : "POST",
    "headers" : { "Content-Type" : "application/x-www-form-urlencoded"
                 },
    "payload" : payload,
    "muteHttpExceptions" : true
  };
  try {
    const response = UrlFetchApp.fetch("https://oauth2.googleapis.com/token", options);
    const jsonResponse  = JSON.parse(response.getContentText());
    const accessToken   = jsonResponse['access_token'];
    const tokenExpire   = jsonResponse['expires_in'];
    if (accessToken != null && tokenExpire != null
    ) {
      this.ACCESS_TOKEN = accessToken;
      this.TOKEN_EXPIRE = timeNonce + tokenExpire - 1;  //  1秒余裕を持たせる
      this.TOKEN_TYPE   = jsonResponse['token_type'];
      console.log("got new access token : "+this.ACCESS_TOKEN);
      return  this.ACCESS_TOKEN;
    }
  }
  catch(e) {
    console.log("API Fetch Error : "+JSON.stringify(e));
  }
}


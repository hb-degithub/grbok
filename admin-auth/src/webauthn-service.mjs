export function createWebAuthnService(adapter, config) {
  const { rpName, rpId, origin } = config;

  return {
    async registrationOptions({ userId, userName, challenge }) {
      return adapter.generateRegistrationOptions({
        rpName,
        rpID: rpId,
        userID: userId,
        userName,
        challenge,
        userVerification: 'required',
      });
    },

    async verifyRegistration({ response, expectedChallenge }) {
      const result = await adapter.verifyRegistrationResponse({
        response,
        expectedChallenge,
        expectedOrigin: origin,
        expectedRPID: rpId,
        requireUserVerification: true,
      });

      // Convert publicKey bytes to base64 so PocketBase hooks can persist it as a string.
      if (result.verified && result.registrationInfo?.credential?.publicKey) {
        const pk = result.registrationInfo.credential.publicKey;
        if (typeof pk !== 'string') {
          result.registrationInfo.credential.publicKey = Buffer.from(pk).toString('base64');
        }
      }

      return result;
    },

    async authenticationOptions({ challenge, allowCredentials }) {
      return adapter.generateAuthenticationOptions({
        rpID: rpId,
        challenge,
        allowCredentials,
        userVerification: 'required',
      });
    },

    async verifyAuthentication({ response, expectedChallenge, authenticator }) {
      let normalizedAuthenticator = authenticator;
      if (authenticator && typeof authenticator.credentialPublicKey === 'string') {
        normalizedAuthenticator = {
          ...authenticator,
          credentialPublicKey: Buffer.from(authenticator.credentialPublicKey, 'base64'),
        };
      }

      return adapter.verifyAuthenticationResponse({
        response,
        expectedChallenge,
        expectedOrigin: origin,
        expectedRPID: rpId,
        authenticator: normalizedAuthenticator,
        requireUserVerification: true,
      });
    },
  };
}

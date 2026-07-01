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
      return adapter.verifyRegistrationResponse({
        response,
        expectedChallenge,
        expectedOrigin: origin,
        expectedRPID: rpId,
        requireUserVerification: true,
      });
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
      return adapter.verifyAuthenticationResponse({
        response,
        expectedChallenge,
        expectedOrigin: origin,
        expectedRPID: rpId,
        authenticator,
        requireUserVerification: true,
      });
    },
  };
}

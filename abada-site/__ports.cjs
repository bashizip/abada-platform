// The platform derives every preview URL from these ports, so they are fixed for the app's
// lifetime — changing one orphans the URL the user already has.
module.exports = {
  website: 4200,
  mobile: 4300,
  desktop: 4400,
};

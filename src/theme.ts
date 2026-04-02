export const theme = {
  fonts: {
    heading: `"Nunito", "Montserrat", sans-serif`,
    body: `"Nunito", "Montserrat", sans-serif`,
  },
  colors: {
    brand: {
      main: "#0d9488",
      100: "#0d94881F",
      300: "#14b8a6",
      400: "#0d9488",
      600: "#0f766e",
    },
  },
  components: {
    Button: {
      variants: {
        primary: {
          bg: "brand.400",
          color: "white",
          _hover: {
            bg: "brand.600",
          },
        },
      },
    },
  },
};

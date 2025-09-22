module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui"],
        // Add custom font families
        heading: ["Poppins", "sans-serif"],
      },
    },
  },
  plugins: [require("tailwind-animate")],
};

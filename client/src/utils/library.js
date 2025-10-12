const hasToBlurImage = ({genres}, showAdultContent = false) => !showAdultContent &&
    (genres || []).some(g => ["hentai", "erotica", "adult"].includes(g.toLowerCase()));

export {
    hasToBlurImage
};

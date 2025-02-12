const fs = require("fs");
const path = require("path");

// Put desired images in the "emojis" directory and run this script to update the JSON file with the file paths of all emojis
// Then run the syncEmojis script to upload the images as emojis to your Discord bot's application emojis

const jsonFile = "../src/utils/JSON/emojis.json";
const directoryPath = path.join(__dirname, "../emojis/");

// Read existing JSON file or initialize an empty object
let fileData = {};
if (fs.existsSync(jsonFile)) {
    try {
        fileData = JSON.parse(fs.readFileSync(jsonFile, "utf8"));
    } catch (error) {
        console.error("Error reading JSON file:", error);
    }
}

// Read files in the current directory
fs.readdir(directoryPath, (err, files) => {
    if (err) {
        console.error("Error reading directory:", err);
        return;
    }

    files.forEach(file => {
        const fullPath = path.join(directoryPath, file);
        if (fs.statSync(fullPath).isFile()) {
            console.log(file, typeof file, file.replace('.png', ''))
            fileData[file.replace('.png', '')] = { url: fullPath };
        }
    });

    // Write updated data back to JSON file
    fs.writeFileSync(jsonFile, JSON.stringify(fileData, null, 2));
    console.log("File list updated successfully.");
});

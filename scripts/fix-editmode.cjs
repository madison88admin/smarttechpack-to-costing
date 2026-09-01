const fs = require('fs');
const path = 'C:\\Users\\JC\\OneDrive - Madison88\\Documents\\Smart Tech Pack-to-Costing Approval Tool\\src\\components\\factory-cbd-form.tsx';
let content = fs.readFileSync(path, 'utf8');

if (!content.includes('editMode')) {
  console.log('No editMode references found - already fixed');
  process.exit(0);
}

console.log('Found editMode references, fixing...');

// Simple string replacement - find and replace the editMode blocks
const oldNotice = `{readOnly ? null : (
          <p className="notice">
            {editMode === "costing"
              ? "Review the summary above. Click Save Changes to update the CBD with your corrections."
              : "Review the summary above. Click Save Draft to continue later, or Submit to Costing to send for review."}
          </p>
        )}`;

const newNotice = `{readOnly ? null : (
          <p className="notice">Review the summary above. Click <strong>Save Draft</strong> to continue later, or <strong>Submit to Costing</strong> to send for review.</p>
        )}`;

content = content.replace(oldNotice, newNotice);

// Replace the editMode button section
const oldButtons = `            ) : editMode === "costing" ? (
              <>
                <button className="button" type="submit" disabled={state === "saving"}>
                  {state === "saving" ? <><span className="spinner" /> Saving...</> : "Save Changes"}
                </button>
                {message ? <span className={\`form-message \${state}\`}>{message}</span> : null}
              </>
            ) : (
              <>
                <button className="button secondary" type="submit" disabled={state === "saving"}>
                  {state === "saving" ? <><span className="spinner" /> Saving...</> : "Save Draft"}
                </button>`;

const newButtons = `            ) : (
              <>
                <button className="button secondary" type="submit" disabled={state === "saving"}>
                  {state === "saving" ? <><span className="spinner" /> Saving...</> : "Save Draft"}
                </button>`;

content = content.replace(oldButtons, newButtons);

fs.writeFileSync(path, content, 'utf8');
console.log('Done. Checking for remaining editMode references...');
const newContent = fs.readFileSync(path, 'utf8');
const matches = newContent.match(/editMode/g);
console.log('Remaining editMode references:', matches ? matches.length : 0);

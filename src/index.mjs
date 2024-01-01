import fs from 'fs/promises';
import crypto from 'crypto';
import path from 'path';
import readline from 'readline';
import { SingleBar, Presets as ProgressBarPresets } from 'cli-progress';
import { hideBin } from 'yargs/helpers';
import yargs from 'yargs';

let logVerboseFlag = false, logInfoFlag = true;

function logInfo(msg) {
	if (logInfoFlag) {
		console.log(msg);
	}
}

function logVerbose(msg) {
	if (logVerboseFlag) {
		console.log(msg);
	}
}

function generateRandomData(size) {
	return crypto.randomBytes(size);
}

function generateHash(data) {
	const hash = crypto.createHash('sha256');
	hash.update(data);
	return hash.digest('hex');
}

async function writeFileAndHash(filename, data) {
	await fs.writeFile(filename, data);
	return generateHash(data);
}

async function verifyFileHash(filename, originalHash) {
	const data = await fs.readFile(filename);
	const hash = generateHash(data);
	return hash === originalHash;
}

function keepThreeSignificantFigures(number) {
	if (number === 0) {
		return '0.00';
	}

	let magnitude = Math.floor(Math.log10(Math.abs(number)));
	let factor = Math.pow(10, 2 - magnitude);
	let roundedNumber = Math.round(number * factor) / factor;
	return roundedNumber.toString();
}

function parseFileSize(fileSizeString) {
	const units = {
		'': 1,
		'K': 1024,
		'M': 1024 ** 2,
		'G': 1024 ** 3,
		'T': 1024 ** 4,
		'P': 1024 ** 5,
	};

	const regex = /^(\d*\.?\d+)([KMGTP]?)B?$/;
	const match = fileSizeString.match(regex);

	if (!match) {
		throw new Error(`Cannot understand file size string: ${fileSizeString}`);
	}

	const size = parseFloat(match[1]);
	const unit = match[2];

	if (isNaN(size)) {
		throw new Error(`Cannot understand file size string: ${fileSizeString}`);
	}

	if (size > Number.MAX_SAFE_INTEGER) {
		throw new Error(`${fileSizeString} is too large, please do not exceed 7.99PB`);
	}

	return Math.floor(size * units[unit]);
}

function formatFileSize(bytes) {
	const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
	let value = bytes;

	let unitIndex = 0;
	while (value >= 1024 && unitIndex < units.length - 1) {
		value /= 1024;
		unitIndex++;
	}

	return keepThreeSignificantFigures(value) + units[unitIndex];
}

function pressEnterToContinue() {
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout
	});

	return new Promise((resolve) => {
		rl.question('(press enter to continue)', (answer) => {
			rl.close();
			resolve(answer);
		});
	});
}

async function checkFolder(path) {
	try {
		await fs.access(path);
		return true;
	} catch (err) {
		return false;
	}
}

let progressBar = null;
async function main() {
	const args = yargs(hideBin(process.argv))
		.option('chunk-count', {
			description: 'Number of chunks to write',
			alias: 'n',
			type: 'number',
			default: 1,
		}).option('chunk-size', {
			description: 'Size of each chunk',
			alias: 's',
			type: 'string',
			default: '256M',
		}).option('quiet', {
			description: 'Do not log except for errors',
			alias: 'q',
			type: 'boolean',
			default: false,
		}).option('verbose', {
			description: 'Verbose log output',
			alias: 'v',
			type: 'boolean',
			default: false,
		}).option('progress-bar', {
			description: 'Output a terminal progress bar',
			default: true,
			type: 'boolean',
		}).option('suppress-tmux-warning', {
			description: 'Suppress warning of not inside a TMUX session',
			type: 'boolean',
			default: false,
		}).usage('Uasge: <path>').version('0.1.0').help().alias('help', 'h').argv;

	const chunkSize = parseFileSize(args.chunkSize);
	const folderPath = args._[0] ?? '.';
	const numberOfFiles = args.chunkCount;
	if (args.verbose) {
		logVerboseFlag = true;
	}
	if (args.quiet) {
		logInfoFlag = logVerboseFlag = false;
	}

	if (!checkFolder(folderPath)) {
		throw new Error(`${folderPath} is no accessable.`);
	}

	if (!args.suppressTmuxWarning && process.env.TMUX == null && process.env.STY == null) {
		logInfo('It seems that you are NOT inside a tmux or screen session!!');
		await pressEnterToContinue();
	}

	if (args.progressBar) {
		progressBar = new SingleBar({}, ProgressBarPresets.shades_classic);
	}

	const hashes = [];
	let filesWritten = 0;
	progressBar?.start(numberOfFiles, 0);
	for (let i = 0; i < numberOfFiles; i++) {
		const data = generateRandomData(chunkSize);
		const i_name = i.toString().padStart(5, '0');
		const filename = path.join(folderPath, `chk_${i_name}.bin`);
		try {
			const hash = await writeFileAndHash(filename, data);
			logVerbose(`Wrote chunk #${i_name} with hash: ${hash}`);
			hashes.push(hash);
			filesWritten++;
		} catch (error) {
			if (error.code === 'ENOSPC') {
				logInfo(`Failed to write chunk #${i_name}: No space left on device`);
			} else {
				logInfo(`Failed to write chunk #${i_name}: ${error.code}`);
			}
			logInfo('No space left on device. Moving to verification...');
			break;
		}
		progressBar?.update(i + 1);
	}
	progressBar?.stop();
	logInfo(`Wrote ${filesWritten} chunks, totalling ${formatFileSize(filesWritten * chunkSize)} data.`);

	progressBar?.start(filesWritten, 0);
	for (let i = 0; i < filesWritten; i++) {
		const i_name = i.toString().padStart(5, '0');
		const filename = path.join(folderPath, `chk_${i_name}.bin`);
		const isValid = await verifyFileHash(filename, hashes[i]);
		if (!isValid) {
			throw new Error(`Verification failed for chunk #${i_name}`);
		}
		logVerbose(`Verified chunk #${i_name}.`);
		progressBar?.update(i + 1);
	}
	progressBar?.stop();

	logInfo(`Verified ${filesWritten} chunks, totalling ${formatFileSize(filesWritten * chunkSize)} data`);
	if (filesWritten === numberOfFiles) {
		logInfo('All chunks have been written and verified successfully');
	} else {
		logInfo('Partly done, some chunks have errors.');
	}
}

main().catch((err) => {
	progressBar?.stop();
	console.error(`An error occurred: ${err}`);
	process.exit(1);
});

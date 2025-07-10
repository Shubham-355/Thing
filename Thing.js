const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { execSync } = require('child_process');
const chalk = require('chalk');

class TerminalCoder {
    constructor() {
        this.projectRoot = process.cwd();
        this.genAI = null;
        this.fileCache = new Map();
        this.projectType = null;
        this.excludePatterns = [
            'node_modules',
            '.git',
            'dist',
            'build',
            '.next',
            '.env',
            '*.log',
            'Thing.js'
        ];
    }

    async initialize() {
        
         console.log(`\x1b[38;2;217;119;87m
 ████████╗██╗  ██╗██╗███╗   ██╗ ██████╗
 ╚══██╔══╝██║  ██║██║████╗  ██║██╔════╝
    ██║   ███████║██║██╔██╗ ██║██║  ███╗
    ██║   ██╔══██║██║██║╚██╗██║██║   ██║
    ██║   ██║  ██║██║██║ ╚████║╚██████╔╝
    ╚═╝   ╚═╝  ╚═╝╚═╝╚═╝  ╚═══╝ ╚═════╝
\x1b[0m`);

        
        // Detect project type
        this.detectProjectType();
        // console.log(`📦 Project Type: ${this.projectType}`);
        
        // Check and install dependencies if needed
        await this.ensureDependencies();
        
        // Check for API key and handle setup
        await this.ensureApiKey();

        // Initialize Gemini with the new API
        try {
            const { GoogleGenAI } = require('@google/genai');
            this.genAI = new GoogleGenAI({});
            // console.log('✅ Gemini API initialized successfully');
        } catch (error) {
            console.error('❌ Failed to initialize Gemini API:', error.message);
            console.log('💡 Make sure you have the latest @google/genai package installed');
            process.exit(1);
        }
        
        // console.log(`📁 Project Root: ${this.projectRoot}`);
        await this.scanProject();
        this.startInteractiveMode();
    }

    async ensureApiKey() {
        // First check environment variable
        let apiKey = process.env.GEMINI_API_KEY;
        
        // If not in env, check .env file
        if (!apiKey) {
            apiKey = this.loadApiKeyFromEnv();
        }
        
        // If still no API key, prompt user
        if (!apiKey) {
            console.log('🔑 Gemini API Key Setup Required');
            // console.log('=====================================');
            console.log('💡 Get your free API key from: https://aistudio.google.com/app/apikey\n');
            
            apiKey = await this.promptForApiKey();
            
            if (!apiKey) {
                console.error('❌ API key is required to use Terminal Coder');
                process.exit(1);
            }
            
            // Save to .env file
            this.saveApiKeyToEnv(apiKey);
            console.log('✅ API key saved to .env file\n');
        } else {
            console.log('\n');
        }
        
        // Set in environment for this session
        process.env.GEMINI_API_KEY = apiKey;
    }

    loadApiKeyFromEnv() {
        const envPath = path.join(this.projectRoot, '.env');
        
        if (fs.existsSync(envPath)) {
            try {
                const envContent = fs.readFileSync(envPath, 'utf8');
                const match = envContent.match(/^GEMINI_API_KEY\s*=\s*(.+)$/m);
                return match ? match[1].trim().replace(/['"]/g, '') : null;
            } catch (error) {
                console.log('⚠️  Could not read .env file');
            }
        }
        
        return null;
    }

    async promptForApiKey() {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        return new Promise((resolve) => {
            rl.question('🔑 Please paste your Gemini API key: ', (apiKey) => {
                rl.close();
                resolve(apiKey.trim());
            });
        });
    }

    saveApiKeyToEnv(apiKey) {
        const envPath = path.join(this.projectRoot, '.env');
        const envLine = `GEMINI_API_KEY=${apiKey}\n`;
        
        try {
            if (fs.existsSync(envPath)) {
                // Read existing .env content
                let envContent = fs.readFileSync(envPath, 'utf8');
                
                // Check if GEMINI_API_KEY already exists
                if (envContent.includes('GEMINI_API_KEY')) {
                    // Replace existing line
                    envContent = envContent.replace(/^GEMINI_API_KEY\s*=.*$/m, `GEMINI_API_KEY=${apiKey}`);
                } else {
                    // Add new line
                    envContent += envContent.endsWith('\n') ? envLine : '\n' + envLine;
                }
                
                fs.writeFileSync(envPath, envContent);
            } else {
                // Create new .env file
                fs.writeFileSync(envPath, envLine);
            }
            
            // Add .env to excludePatterns if not already there
            if (!this.excludePatterns.includes('.env')) {
                this.excludePatterns.push('.env');
            }
            
        } catch (error) {
            console.log('⚠️  Could not save to .env file:', error.message);
            console.log('💡 Please manually set GEMINI_API_KEY environment variable');
        }
    }

    detectProjectType() {
        const packageJsonPath = path.join(this.projectRoot, 'package.json');
        
        if (fs.existsSync(packageJsonPath)) {
            try {
                const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
                const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
                
                if (deps.next) {
                    this.projectType = 'Next.js';
                    this.excludePatterns.push('.next', 'out');
                } else if (deps.react) {
                    this.projectType = 'React';
                    this.excludePatterns.push('build');
                } else if (deps.vue) {
                    this.projectType = 'Vue.js';
                } else if (deps.express || deps.fastify || deps.koa) {
                    this.projectType = 'Node.js Backend';
                } else {
                    this.projectType = 'Node.js';
                }
            } catch (error) {
                this.projectType = 'Node.js (unknown)';
            }
        } else if (fs.existsSync(path.join(this.projectRoot, 'requirements.txt'))) {
            this.projectType = 'Python';
        } else if (fs.existsSync(path.join(this.projectRoot, 'pom.xml'))) {
            this.projectType = 'Java (Maven)';
        } else if (fs.existsSync(path.join(this.projectRoot, 'Cargo.toml'))) {
            this.projectType = 'Rust';
        } else {
            this.projectType = 'Generic';
        }
    }

    async ensureDependencies() {
        const packageJsonPath = path.join(this.projectRoot, 'package.json');
        
        // Only proceed if it's a Node.js project
        if (!fs.existsSync(packageJsonPath)) {
            console.log('📝 Non-Node.js project detected, skipping dependency check');
            return;
        }

        // Check for required dependencies
        const requiredPackages = ['@google/genai', 'ora'];
        const missingPackages = [];

        for (const pkg of requiredPackages) {
            try {
                require.resolve(pkg);
            } catch (error) {
                missingPackages.push(pkg);
            }
        }

        if (missingPackages.length === 0) {
            // console.log('✅ All dependencies are already installed');
            return;
        }

        console.log(`📦 Installing missing dependencies: ${missingPackages.join(', ')}...`);
        
        try {
            // Install packages one by one to avoid conflicts
            for (const pkg of missingPackages) {
                console.log(`   Installing ${pkg}...`);
                execSync(`npm install ${pkg}`, { 
                    stdio: 'pipe', // Changed from 'inherit' to 'pipe' to reduce noise
                    cwd: this.projectRoot 
                });
            }
            
            console.log('✅ Dependencies installed successfully');
            
            // Verify installation after a brief delay
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Re-check if packages are now available
            const stillMissing = [];
            for (const pkg of requiredPackages) {
                try {
                    require.resolve(pkg);
                } catch (error) {
                    stillMissing.push(pkg);
                }
            }
            
            if (stillMissing.length > 0) {
                throw new Error(`Still missing packages after installation: ${stillMissing.join(', ')}`);
            }
            
        } catch (installError) {
            console.error('❌ Failed to install dependencies automatically');
            console.error('Error details:', installError.message);
            console.log(`💡 Please manually run: npm install ${missingPackages.join(' ')}`);
            console.log('💡 Then restart the application');
            process.exit(1);
        }
    }

    async scanProject() {
        const spinner = await createSpinner('Scanning project files...\n');

        try {
            this.fileCache.clear();
            spinner.updateText('Analyzing directories...');
            spinner.updateText();
            await this.scanDirectory(this.projectRoot);
            spinner.stop();
            // console.log(`✅ Found ${this.fileCache.size} files\n`);
        } catch (error) {
            spinner.stop();
            spinner.fail('❌ Error scanning project:', error.message);
            // console.log('💡 Please check your project structure and try again');
            throw error;
        }
        
    }

    async scanDirectory(dir, level = 0) {
        if (level > 5) return; // Prevent deep recursion
        
        try {
            const items = fs.readdirSync(dir);
            
            for (const item of items) {
                const fullPath = path.join(dir, item);
                const relativePath = path.relative(this.projectRoot, fullPath);
                
                // Skip excluded patterns
                if (this.shouldExclude(relativePath)) continue;
                
                const stats = fs.statSync(fullPath);
                
                if (stats.isDirectory()) {
                    await this.scanDirectory(fullPath, level + 1);
                } else if (this.isCodeFile(fullPath)) {
                    try {
                        const content = fs.readFileSync(fullPath, 'utf8');
                        // Skip very large files
                        if (content.length > 100000) {
                            // console.log(`⚠️  Skipping large file: ${relativePath}`);
                            continue;
                        }
                        
                        this.fileCache.set(relativePath, {
                            path: fullPath,
                            content: content,
                            modified: stats.mtime
                        });
                    } catch (error) {
                        console.log(`⚠️  Could not read ${relativePath}`);
                    }
                }
            }
        } catch (error) {
            console.log(`⚠️  Could not access directory: ${dir}`);
        }
    }

    shouldExclude(path) {
        return this.excludePatterns.some(pattern => {
            if (pattern.includes('*')) {
                const regex = new RegExp(pattern.replace('*', '.*'));
                return regex.test(path);
            }
            return path.includes(pattern);
        });
    }

    isCodeFile(filePath) {
        const codeExtensions = [
            '.js', '.ts', '.jsx', '.tsx', 
            '.py', '.java', '.cpp', '.c', '.cs', 
            '.php', '.rb', '.go', '.rs', '.kt', 
            '.swift', '.dart', '.vue', '.svelte',
            '.html', '.css', '.scss', '.sass',
            '.json', '.xml', '.yaml', '.yml',
            '.md', '.txt', '.env.example'
        ];
        return codeExtensions.some(ext => filePath.endsWith(ext));
    }

    async startInteractiveMode() {
        console.log('💬 Enter your coding request (type "help" for commands):');
        
        const askQuestion = () => {
            const rl = readline.createInterface({
                input: process.stdin,
                output: process.stdout
            });

            rl.question('> ', async (input) => {
                rl.close(); // Close this readline instance
                await this.handleUserInput(input.trim());
                // Continue the loop after handling input
                askQuestion();
            });
        };

        askQuestion();
    }

    showHelp() {
        console.log(`
📖 Available Commands:
- help: Show this help message
- scan: Rescan project files
- list: List all tracked files
- info: Show project information
- exit/quit: Exit the application

💡 How it works:
1. 📤 Thing.js sends YOUR ENTIRE PROJECT to Gemini
2. 🤖 Gemini analyzes ALL files and understands the complete structure
3. ✨ Gemini generates precise changes based on your request
4. 👀 You review the proposed changes before applying
5. 💾 Changes are applied and backed up automatically

🎯 Example requests:
- "Add error handling to login function"
- "Create a new React component for user profile"  
- "Fix the bug in the payment processing"
- "Refactor the database connection code"
- "Add TypeScript types to the API endpoints"
- "Convert this function to use async/await"
- "Add input validation to the form"
- "Create unit tests for the auth module"
- "Update the styling to match the design system"
- "Optimize the performance of the data loading"

🚀 Advanced Features:
- 🧠 Complete project awareness (sends all files to AI)
- 🎯 Context-aware suggestions based on entire codebase
- 🛡️ Safe changes with automatic backups
- 📊 Smart file prioritization for large projects
- 🔄 Handles ${this.fileCache.size} files in your current project
        `);
    }

    async handleUserInput(input) {
        if (!input) return;

        switch (input.toLowerCase()) {
            case 'help':
                this.showHelp();
                break;
            case 'scan':
                await this.scanProject();
                break;
            case 'list':
                this.listFiles();
                break;
            case 'info':
                this.showProjectInfo();
                break;
            case 'exit':
            case 'quit':
                console.log('👋 Goodbye!');
                process.exit(0);
                break;
            default:
                await this.processCodeRequest(input);
                break;
        }
    }

    listFiles() {
        console.log('\n📋 Tracked Files:');
        if (this.fileCache.size === 0) {
            console.log('   No files found. Run "scan" to refresh.');
        } else {
            for (const [relativePath] of this.fileCache) {
                console.log(`  - ${relativePath}`);
            }
        }
        console.log('');
    }

    showProjectInfo() {
        console.log('\n📊 Project Information:');
        console.log(`   Type: ${this.projectType}`);
        console.log(`   Root: ${this.projectRoot}`);
        console.log(`   Files tracked: ${this.fileCache.size}`);
        
        // Show file type breakdown
        const extensions = {};
        for (const [filePath] of this.fileCache) {
            const ext = path.extname(filePath) || 'no extension';
            extensions[ext] = (extensions[ext] || 0) + 1;
        }
        
        console.log('   File types:');
        Object.entries(extensions)
            .sort(([,a], [,b]) => b - a)
            .forEach(([ext, count]) => {
                console.log(`     ${ext}: ${count} files`);
            });
        console.log('');
    }

    async processCodeRequest(request) {
        const spinner = await createSpinner('\n');
        // console.log('📊 Sending ALL project files to Gemini for analysis...');

        try {
            // Prepare COMPLETE context for Gemini (all files)
            const context = this.prepareCompleteContext();
            const prompt = this.buildComprehensivePrompt(request, context);

            // console.log(`📤 Sending ${context.totalFiles} files (${Math.round(context.totalTokens/1000)}k tokens) to Gemini...`);

            // Get response from Gemini using new API format
            const response = await this.genAI.models.generateContent({
                model: "gemini-2.5-flash",
                contents: prompt,
                config: {
                    thinkingConfig: {
                        thinkingBudget: 4096  // Higher budget for comprehensive analysis
                    }
                }
            });

            const responseText = response.text;
            spinner.stop();
            // console.log('✅ Received response\n');

            // Parse and apply changes
            await this.parseAndApplyChanges(responseText);

        } catch (error) {
            console.error('❌ Error processing request:', error.message);
            if (error.message.includes('API key')) {
                console.log('💡 Please check your GEMINI_API_KEY environment variable');
            } else if (error.message.includes('quota') || error.message.includes('limit')) {
                console.log('💡 Token limit exceeded. Try breaking down your request or excluding large files.');
            }
        }
    }

    prepareCompleteContext() {
        const context = {
            projectStructure: Array.from(this.fileCache.keys()),
            fileContents: {},
            totalFiles: this.fileCache.size,
            totalTokens: 0
        };

        // Include ALL files (within reasonable limits)
        const maxTokens = 1000000; // 1M token limit for Gemini
        let tokenCount = 0;
        let filesIncluded = 0;

        // Prioritize important files first
        const sortedFiles = this.prioritizeFiles();

        for (const [relativePath, fileData] of sortedFiles) {
            const fileTokens = fileData.content.length;
            
            if (tokenCount + fileTokens > maxTokens) {
                console.log(`⚠️  Token limit reached. Including ${filesIncluded}/${this.fileCache.size} files`);
                break;
            }
            
            context.fileContents[relativePath] = fileData.content;
            tokenCount += fileTokens;
            filesIncluded++;
        }

        context.totalTokens = tokenCount;
        context.filesIncluded = filesIncluded;
        
        return context;
    }

    prioritizeFiles() {
        // Sort files by importance for better context utilization
        const fileArray = Array.from(this.fileCache.entries());
        
        return fileArray.sort(([pathA], [pathB]) => {
            const priorityA = this.getFilePriority(pathA);
            const priorityB = this.getFilePriority(pathB);
            return priorityB - priorityA; // Higher priority first
        });
    }

    getFilePriority(filePath) {
        const fileName = path.basename(filePath);
        const ext = path.extname(filePath);
        
        // High priority files
        if (fileName === 'package.json') return 100;
        if (fileName === 'README.md') return 90;
        if (fileName.includes('config') || fileName.includes('Config')) return 85;
        if (ext === '.js' || ext === '.ts' || ext === '.jsx' || ext === '.tsx') return 80;
        if (ext === '.py') return 75;
        if (ext === '.html' || ext === '.css' || ext === '.scss') return 70;
        if (ext === '.json' || ext === '.yaml' || ext === '.yml') return 65;
        if (ext === '.md') return 60;
        
        // Lower priority
        return 50;
    }

    buildComprehensivePrompt(request, context) {
        return `You are a professional coding assistant. You have been given COMPLETE access to a ${this.projectType} project with ${context.totalFiles} files.

PROJECT ANALYSIS:
- Project Type: ${this.projectType}
- Files Analyzed: ${context.filesIncluded}/${context.totalFiles}
- Total Context: ~${Math.round(context.totalTokens/1000)}k tokens

PROJECT STRUCTURE:
${context.projectStructure.join('\n')}

COMPLETE FILE CONTENTS:
${Object.entries(context.fileContents).map(([path, content]) => 
    `=== ${path} ===\n${content}\n`
).join('\n')}

USER REQUEST: ${request}

INSTRUCTIONS FOR COMPREHENSIVE ANALYSIS:
1. Analyze the ENTIRE project structure and understand the complete codebase
2. Consider all dependencies, imports, and relationships between files
3. Ensure changes are consistent across the entire project
4. Follow ${this.projectType} best practices and existing patterns
5. DO NOT modify package.json unless explicitly requested
6. Consider impact of changes on the entire application
7. Provide precise, targeted changes only where necessary

RESPONSE FORMAT:
Provide a brief analysis of what you found and what you'll change, then for each file that needs modification:

FILE: path/to/file.ext
ACTION: CREATE|MODIFY|DELETE
EXPLANATION: Detailed explanation of why this change is needed and how it fits with the overall project
CODE:
\`\`\`
[complete file content here]
\`\`\`

Only include files that actually need changes. Be thorough but precise.`;
    }

    async parseAndApplyChanges(response) {
        console.log('\n');
        console.log(chalk.hex('#d97757')('Thing Response Analysis:'));
        console.log('\n');

        const fileChanges = this.extractFileChanges(response);
        
        if (fileChanges.length === 0) {
            console.log('💬 Thing Response (No file changes detected):');
            console.log(response);
            console.log('\n🤖 If you expected file changes, try rephrasing your request to be more specific.\n');
            return;
        }

        // Show comprehensive preview of changes
        console.log(`🔍 Thing analyzed your entire project and proposes ${fileChanges.length} file changes:\n`);
        
        fileChanges.forEach((change, index) => {
            console.log(`${index + 1}. ${change.action} ${change.path}`);
            console.log(`   💡 ${change.explanation}`);
            if (change.code) {
                const lines = change.code.split('\n').length;
                const chars = change.code.length;
                console.log(`   📄 Content: ${lines} lines, ${chars} characters`);
            }
            console.log('');
        });

        // Ask for confirmation with detailed info
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        console.log('⚠️  IMPORTANT: These changes will be written to your files immediately.');
        console.log('🔄 Make sure you have committed your current work to git before proceeding.\n');

        return new Promise((resolve) => {
            rl.question('🤔 Apply these changes to your project? (y/N): ', async (answer) => {
                rl.close(); // Close this readline instance
                
                if (answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes') {
                    await this.applyChanges(fileChanges);
                } else {
                    console.log('❌ Changes cancelled - your files remain unchanged\n');
                    console.log('💡 You can modify your request and try again.\n');
                }
                resolve(); // Resolve the promise to continue the flow
            });
        });
    }

    extractFileChanges(response) {
        const changes = [];
        
        // Split by FILE: markers to find individual file changes
        const fileBlocks = response.split(/^FILE:\s*/m);
        
        for (let i = 1; i < fileBlocks.length; i++) {
            const block = fileBlocks[i];
            const lines = block.split('\n');
            
            const filePath = lines[0].trim();
            const actionMatch = block.match(/ACTION:\s*(CREATE|MODIFY|DELETE)/i);
            const explanationMatch = block.match(/EXPLANATION:\s*([^\n]+(?:\n(?!FILE:|ACTION:|CODE:)[^\n]*)*)/i);
            const codeMatch = block.match(/CODE:\s*```[^\n]*\n([\s\S]*?)```/);
            
            if (actionMatch) {
                changes.push({
                    path: filePath,
                    action: actionMatch[1].toUpperCase(),
                    explanation: explanationMatch ? explanationMatch[1].trim() : 'No explanation provided',
                    code: codeMatch ? codeMatch[1].trim() : ''
                });
            }
        }
        
        return changes;
    }

    async applyChanges(changes) {
        console.log('✨ Applying changes to your project...\n');
        
        let successCount = 0;
        let errorCount = 0;

        // Create backups folder at root level if it doesn't exist
        const backupsDir = path.join(this.projectRoot, 'backups');
        if (!fs.existsSync(backupsDir)) {
            fs.mkdirSync(backupsDir, { recursive: true });
            console.log(`📁 Created backups directory: ${backupsDir}`);
        }

        // Create timestamp-based backup session folder
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0] + '_' + 
                         new Date().toTimeString().slice(0,8).replace(/:/g, '-');
        const sessionBackupDir = path.join(backupsDir, `backup_${timestamp}`);
        fs.mkdirSync(sessionBackupDir, { recursive: true });

        for (const change of changes) {
            try {
                const fullPath = path.resolve(this.projectRoot, change.path);
                
                switch (change.action) {
                    case 'CREATE':
                        // Ensure directory exists
                        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
                        fs.writeFileSync(fullPath, change.code, 'utf8');
                        console.log(`✅ Created: ${change.path}`);
                        successCount++;
                        break;
                        
                    case 'MODIFY':
                        // Backup original if it exists
                        if (fs.existsSync(fullPath)) {
                            // Create backup with proper directory structure
                            const relativePath = path.relative(this.projectRoot, fullPath);
                            const backupFilePath = path.join(sessionBackupDir, relativePath);
                            
                            // Ensure backup directory structure exists
                            fs.mkdirSync(path.dirname(backupFilePath), { recursive: true });
                            
                            // Copy original to backup location
                            fs.copyFileSync(fullPath, backupFilePath);
                            console.log(`💾 Backed up: ${relativePath} → backups/backup_${timestamp}/${relativePath}`);
                        }
                        fs.writeFileSync(fullPath, change.code, 'utf8');
                        console.log(`✅ Modified: ${change.path}`);
                        successCount++;
                        break;
                        
                    case 'DELETE':
                        if (fs.existsSync(fullPath)) {
                            // Backup before deletion
                            const relativePath = path.relative(this.projectRoot, fullPath);
                            const backupFilePath = path.join(sessionBackupDir, relativePath);
                            
                            // Ensure backup directory structure exists
                            fs.mkdirSync(path.dirname(backupFilePath), { recursive: true });
                            
                            // Copy to backup before deletion
                            fs.copyFileSync(fullPath, backupFilePath);
                            console.log(`💾 Backed up before deletion: ${relativePath} → backups/backup_${timestamp}/${relativePath}`);
                            
                            fs.unlinkSync(fullPath);
                            console.log(`✅ Deleted: ${change.path}`);
                            successCount++;
                        } else {
                            console.log(`⚠️  File not found for deletion: ${change.path}`);
                        }
                        break;
                }
                
                // Update file cache with new/modified content
                if (change.action !== 'DELETE') {
                    this.fileCache.set(change.path, {
                        path: fullPath,
                        content: change.code,
                        modified: new Date()
                    });
                } else {
                    this.fileCache.delete(change.path);
                }
                
            } catch (error) {
                console.error(`❌ Failed to ${change.action.toLowerCase()} ${change.path}:`, error.message);
                errorCount++;
            }
        }
        
        console.log(`\n🎉 Changes applied successfully!`);
        console.log(`   ✅ Successful: ${successCount}`);
        if (errorCount > 0) {
            console.log(`   ❌ Errors: ${errorCount}`);
        }
        console.log(`   📁 Backups stored in: backups/backup_${timestamp}/`);
        console.log(`\n💡 Your project has been updated. Test the changes and commit when ready.`);
        console.log(`\n💬 Ready for your next request:\n`);
    }
}

async function createSpinner(text = 'Loading...', options = {}) {
    const { default: ora } = await import('ora');
    
    const spinner = ora({
        text,
        color: 'blue',
        spinner: 'dots',
        ...options
    }).start();

    return {
        updateText: (newText) => {
            spinner.text = newText;
        },
        succeed: (successText) => {
            spinner.succeed(successText);
        },
        fail: (failText) => {
            spinner.fail(failText);
        },
        warn: (warnText) => {
            spinner.warn(warnText);
        },
        info: (infoText) => {
            spinner.info(infoText);
        },
        stop: () => {
            spinner.stop();
        }
    };
}

// Start the application
if (require.main === module) {
    const terminalCoder = new TerminalCoder();
    terminalCoder.initialize().catch(console.error);
}

module.exports = TerminalCoder;

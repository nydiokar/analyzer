## 1. Feature Location: A New "Analysis Lab" Page
I propose we create a new, top-level page called "Analysis Lab".
Why a new page? This type of analysis (multi-wallet, on-demand, potentially heavy) is functionally different from looking at a single wallet's profile. It deserves its own dedicated space, free from the context of a single wallet. This also gives us a home for future on-demand analysis tools (like Correlation).
Location: It would live at /analysis-lab and have a dedicated link in the main sidebar navigation, maybe with an icon like a beaker or microscope.

## 2. User Input: Handling Both Manual and Bulk Analysis
The UI on this page needs to be flexible. I envision a two-part input section:

### Part A: The Wallet Staging Area
A primary component where users can build their list of wallets to analyze.
Manual Input: A search box (reusing our existing wallet search component) where a user can type or paste an address. Upon selection, the wallet is added to a "Staging List" below it. They can repeat this for 2, 3, 5, etc., wallets.

Bulk Input: A button right next to the search box labeled "Import List".
Clicking this opens a simple modal with a large text area.
Users can paste a list of addresses (one per line, comma-separated, etc. - we'll make the parser flexible).

A "Load from CSV/TXT" button would also be present to handle file uploads directly.
On submission, these wallets populate the "Staging List".
The Staging List: This shows the wallets queued for analysis. Each entry has a small "remove" (X) icon. This list gives the user a final confirmation of what they are about to analyze.

### Part B: Analysis Configuration
Below the staging area, a simple section with the "Run" button and options:
Analysis Type: A dropdown that defaults to "Similarity Analysis".
Vector Type: A segmented control or radio button group to select between Capital (default) and Binary. We'll add a small (?) tooltip explaining the difference simply.
Run Analysis Button: This button is disabled until at least two wallets are in the staging list. Clicking it triggers the API call.

## 3. Output Display: Distilling the "Wall of Text"
This is the most critical part. We cannot just dump the report. We must structure the results into digestible, insight-driven components. Based on my analysis of your report, here's how we'll break it down:
I've created a diagram to visualize the proposed layout of the results screen.

graph TD
    subgraph "Analysis Lab Results Screen"
        A("Key Insights & Summary")
        B("Top 10 Most Similar Pairs Table")
        C("All Pairs Connection Strength Table")
        D("Most Common Tokens")
    end

    A --> B
    A --> C
    A --> D

    style A fill:#f9f,stroke:#333,stroke-width:2px
    style B fill:#ccf,stroke:#333,stroke-width:2px
    style C fill:#ccf,stroke:#333,stroke-width:2px
    style D fill:#cfc,stroke:#333,stroke-width:2px

    subgraph "Key Insights & Summary"
        direction LR
        A1("Significant Asymmetry<br/>(e.g., 4iPmXAB1 & HmdHaJW4)")
        A2("Focused Investment Pattern<br/>(e.g., DNfuF1L6 >100%)")
        A3("Very High Similarity / Strong Concordance<br/>(e.g., BdX3nyjY & DTTbjcmb)")
    end

    subgraph "Top 10 Most Similar Pairs Table"
        direction LR
        B1("Rank | Pair | Score | Shared %")
        B2("Expandable Row:<br/>- Top 5 Shared Tokens<br/>- Capital Allocation %")
    end

    subgraph "All Pairs Connection Strength Table"
        direction LR
        C1("Sortable/Filterable Table:<br/>- Wallet A | Wallet B | Primary Score | Jaccard Score | Shared Count | Insight Tags")
        C2("Color-coded rows or tags (Strongly, Mildly, Barely)")
    end
    
    subgraph "Most Common Tokens"
        direction LR
        D1("List of tokens shared by the most wallets in the set.<br/>e.g., HCUGyaVLQtnz... (43 Wallets)")
    end

    click A "#" "Top-level summary card showing pre-digested insights from the report."
    click B "#" "A clean table for the highest-ranked pairs, with details on demand."
    click C "#" "A powerful, detailed table for users who want to dig deeper."
    click D "#" "A small, interesting card for at-a-glance token overlap."



## This structure presents the information in a logical hierarchy:

### Key Insights Card (Component A): This is the first thing the user sees. It directly displays the bullet points from the "Key Insights" section of the report. This provides immediate value and tells the user what's most interesting.

### Top 10 Pairs Table (Component B): This component shows the most actionable data: the pairs with the highest similarity scores. Each row would be expandable to show the top shared tokens and their capital allocation, preventing information overload.


### All Pairs Connection Strength Table (Component C): For deeper analysis, this will be a powerful, sortable, and filterable data table. Users could sort by Jaccard score, filter for pairs with the "Strong Concordance" (*SC*) tag, or search for a specific wallet. This is where the bulk of the data lives, but in a structured, manageable format.

### Common Tokens Card (Component D): A smaller, secondary card that lists the tokens most frequently shared across the entire set, taken from the "Shared Token Details" part of the report.

By breaking the report down this way, we transform a "10-page report" into an interactive, multi-faceted dashboard that guides the user from high-level insights to granular data.

## Summary of the User Flow

1. User navigates to the "Analysis Lab" page from the sidebar.
2. They add wallets manually and/or via bulk import to the "Staging List".
3. They select the vectorType and click "Run Analysis".
4. A loading state appears over the results area.

On completion, the results are displayed in the four-component layout described above.
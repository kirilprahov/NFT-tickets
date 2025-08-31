import * as anchor from "@coral-xyz/anchor";
import { expect } from "chai";

import { Program } from "@coral-xyz/anchor";
import {
    Keypair,
    ComputeBudgetProgram,
    SystemProgram,
    PublicKey,
    LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
    getAssociatedTokenAddressSync,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    getAccount,
} from "@solana/spl-token";

// Token Metadata program
const TOKEN_METADATA_ID = new PublicKey(
    "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
); // mainnet id used on all clusters
const SYSVAR_INSTRUCTIONS_PUBKEY = new PublicKey(
    "Sysvar1nstructions1111111111111111111111111"
);

// PDAs for metadata & edition
function findMetadataPda(mint: PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync(
        [Buffer.from("metadata"), TOKEN_METADATA_ID.toBuffer(), mint.toBuffer()],
        TOKEN_METADATA_ID
    )[0];
}
function findMasterEditionPda(mint: PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync(
        [
            Buffer.from("metadata"),
            TOKEN_METADATA_ID.toBuffer(),
            mint.toBuffer(),
            Buffer.from("edition"),
        ],
        TOKEN_METADATA_ID
    )[0];
}
// Treasury PDA: [b"treasury", mint]
function findTreasuryPda(programId: PublicKey, mint: PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync(
        [Buffer.from("treasury"), mint.toBuffer()],
        programId
    )[0];
}

describe("nft_tikets – end-to-end", () => {
    const provider = anchor.AnchorProvider.local();
    anchor.setProvider(provider);
    const connection = provider.connection;

    const program = anchor.workspace.nft_tikets as Program<any>;

    // Actors
    const payer = provider.wallet as anchor.Wallet;
    const updateAuthority = Keypair.generate();

    // helper: airdrop
    const airdrop = async (pubkey: PublicKey, sol = 1) => {
        const sig = await connection.requestAirdrop(
            pubkey,
            sol * LAMPORTS_PER_SOL
        );
        await connection.confirmTransaction(sig, "confirmed");
    };

    it("creates an event (collection) and buys a ticket; verifies transfer and owners", async () => {
        // fund required signers
        await airdrop(updateAuthority.publicKey, 2);

        //
        // 1) EVENT (Sized Collection)
        //
        const collectionMint = Keypair.generate();
        const collectionOwner = Keypair.generate(); // collection NFT holder

        const collectionAta = getAssociatedTokenAddressSync(
            collectionMint.publicKey,
            collectionOwner.publicKey,
            false,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
        );
        const collectionMetadata = findMetadataPda(collectionMint.publicKey);
        const collectionEdition = findMasterEditionPda(collectionMint.publicKey);
        const collectionTreasury = findTreasuryPda(
            program.programId,
            collectionMint.publicKey
        );

        await airdrop(collectionOwner.publicKey, 1);

        const price = new anchor.BN(1_000_000); // 0.001 SOL
        const eventTs = new anchor.BN(Math.floor(Date.now() / 1000));

        const createEventTx = await program.methods
            .mintNftEvent(
                "My Collection",
                "COLL",
                "https://example.com/collection.json",
                500,
                true,
                price,
                eventTs
            )
            .accounts({
                payer: payer.publicKey,
                updateAuthority: updateAuthority.publicKey,
                mint: collectionMint.publicKey,
                treasury: collectionTreasury, // <-- required
                owner: collectionOwner.publicKey,
                associatedTokenAccount: collectionAta,
                metadata: collectionMetadata,
                masterEdition: collectionEdition,
                systemProgram: SystemProgram.programId,
                associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                tokenProgram: TOKEN_PROGRAM_ID,
                tokenMetadataProgram: TOKEN_METADATA_ID,
                sysvarInstructions: SYSVAR_INSTRUCTIONS_PUBKEY,
            })
            .signers([updateAuthority, collectionMint])
            .rpc();

        {
            const latest = await connection.getLatestBlockhash();
            await connection.confirmTransaction(
                { signature: createEventTx, ...latest },
                "confirmed"
            );

            // assert collection owner holds 1 NFT
            const ataAcc = await getAccount(
                connection,
                collectionAta,
                "confirmed",
                TOKEN_PROGRAM_ID
            );
            expect(ataAcc.amount).to.equal(1n);

            // assert metadata/master edition exist
            const md = await connection.getAccountInfo(collectionMetadata, "confirmed");
            const me = await connection.getAccountInfo(collectionEdition, "confirmed");
            expect(md).to.not.be.null;
            expect(me).to.not.be.null;
        }

        //
        // 2) BUY TICKET (mintNftTicket) into collection
        //
        const ticketMint = Keypair.generate();
        const ticketOwner = Keypair.generate();

        const ticketAta = getAssociatedTokenAddressSync(
            ticketMint.publicKey,
            ticketOwner.publicKey,
            false,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
        );
        const ticketMetadata = findMetadataPda(ticketMint.publicKey);
        const ticketEdition = findMasterEditionPda(ticketMint.publicKey);

        await airdrop(ticketOwner.publicKey, 1);

        // capture balances before purchase
        const payerBefore = BigInt(await connection.getBalance(payer.publicKey));
        const treasuryBefore = BigInt(
            await connection.getBalance(collectionTreasury)
        );

        // optional compute units tweak (not strictly needed on localnet)
        const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({
            units: 800_000,
        });
        const addPriorityFee = ComputeBudgetProgram.setComputeUnitPrice({
            microLamports: 1,
        });

        const buyTicketTx = await program.methods
            .mintNftTicket(
                "My Ticket #1",
                "TKT",
                "https://example.com/ticket-1.json",
                500,
                true
            )
            .accounts({
                payer: payer.publicKey,
                updateAuthority: updateAuthority.publicKey,

                // previously created collection treasury
                treasury: collectionTreasury,

                mint: ticketMint.publicKey,
                owner: ticketOwner.publicKey,
                associatedTokenAccount: ticketAta,

                // collection
                collectionMint: collectionMint.publicKey,
                collectionMetadata: collectionMetadata,
                collectionMasterEdition: collectionEdition,
                collectionAuthority: updateAuthority.publicKey,

                // ticket metadata/master edition
                metadata: ticketMetadata,
                masterEdition: ticketEdition,

                systemProgram: SystemProgram.programId,
                associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                tokenProgram: TOKEN_PROGRAM_ID,
                tokenMetadataProgram: TOKEN_METADATA_ID,
                sysvarInstructions: SYSVAR_INSTRUCTIONS_PUBKEY,
            })
            .preInstructions([addPriorityFee, modifyComputeUnits])
            .signers([updateAuthority, ticketMint])
            .rpc();

        {
            const latest = await connection.getLatestBlockhash();
            await connection.confirmTransaction(
                { signature: buyTicketTx, ...latest },
                "confirmed"
            );

            // assert ticket ownership
            const ataAcc = await getAccount(
                connection,
                ticketAta,
                "confirmed",
                TOKEN_PROGRAM_ID
            );
            expect(ataAcc.amount).to.equal(1n);

            // assert metadata/master edition exist
            const md = await connection.getAccountInfo(ticketMetadata, "confirmed");
            const me = await connection.getAccountInfo(ticketEdition, "confirmed");
            expect(md).to.not.be.null;
            expect(me).to.not.be.null;

            // Funds: treasury delta should equal treasury.price
            const payerAfter = BigInt(await connection.getBalance(payer.publicKey));
            const treasuryAfter = BigInt(
                await connection.getBalance(collectionTreasury)
            );
            const treasuryDelta = treasuryAfter - treasuryBefore;

            // fetch Treasury account via program (IDL must include "treasury" account)
            const treasuryAcc = await program.account.treasury.fetch(
                collectionTreasury
            );
            const price = BigInt(treasuryAcc.price.toString()); // BN -> BigInt

            expect(treasuryDelta).to.equal(price);

            // payer includes fees/rent — ensure at least price was debited
            const payerDelta = payerBefore - payerAfter;
            expect(payerDelta >= price).to.equal(true);

            // Ownership logs
            console.log("=== OWNERS ===");
            console.log("Collection mint:", collectionMint.publicKey.toBase58());
            console.log("Collection NFT holder:", collectionOwner.publicKey.toBase58());
            console.log("Collection update authority:", updateAuthority.publicKey.toBase58());
            console.log("Ticket mint:", ticketMint.publicKey.toBase58());
            console.log("Ticket NFT holder:", ticketOwner.publicKey.toBase58());
            console.log("Treasury PDA:", collectionTreasury.toBase58());
            console.log("Price (lamports):", price.toString());
            console.log("Treasury Δ (lamports):", treasuryDelta.toString());
            console.log("Payer Δ (lamports):", payerDelta.toString());
            console.log("================");
        }
    });
});

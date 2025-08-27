import * as anchor from "@coral-xyz/anchor";
import { expect } from "chai";

import { Program } from "@coral-xyz/anchor";
import { Keypair, ComputeBudgetProgram, SystemProgram, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import {
    getAssociatedTokenAddressSync,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    getAccount,
} from "@solana/spl-token";


// Token Metadata program
const TOKEN_METADATA_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"); // mainnet id used on all clusters
const SYSVAR_INSTRUCTIONS_PUBKEY = new PublicKey(
    "Sysvar1nstructions1111111111111111111111111"
);


// PDAs for metadata & edition
function findMetadataPda(mint: PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync(
        [
            Buffer.from("metadata"),
            TOKEN_METADATA_ID.toBuffer(),
            mint.toBuffer(),
        ],
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

describe("nft_tikets", () => {
    const provider = anchor.AnchorProvider.local();
    anchor.setProvider(provider);
    const connection = provider.connection;

    // If you generated TypeScript types, you can import them; otherwise use `any`
    const program = anchor.workspace.nft_tikets as Program<any>;

    // Test actors
    const payer = (provider.wallet as anchor.Wallet);
    const updateAuthority = Keypair.generate();
    const mintAuthority = Keypair.generate();
    const owner = Keypair.generate();

    // Mint/ATA addresses (program will init them)
    const mint = Keypair.generate();
    const ownerAta = getAssociatedTokenAddressSync(
        mint.publicKey,
        owner.publicKey,
        false,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
    );

    // Metadata PDAs
    const metadata = findMetadataPda(mint.publicKey);
    const masterEdition = findMasterEditionPda(mint.publicKey);

    // helper: airdrop to a signer
    const airdrop = async (pubkey: PublicKey, sol = 1) => {
        const sig = await connection.requestAirdrop(pubkey, sol * LAMPORTS_PER_SOL);
        await connection.confirmTransaction(sig, "confirmed");
    };

    it("mints an event NFT and verifies accounts", async () => {
        // fund the extra signers so they can pay rent if needed
        await airdrop(updateAuthority.publicKey, 1);
        await airdrop(mintAuthority.publicKey, 1);
        await airdrop(owner.publicKey, 1);

        const name = "My Event";
        const symbol = "EVT";
        const uri = "https://example.com/metadata.json";
        const sellerFeeBps = 500; // 5%
        const isMutable = true;

        // call the instruction
        const txSig = await program.methods
            .mintNftEvent(name, symbol, uri, sellerFeeBps, isMutable)
            .accounts({
                payer: payer.publicKey,
                updateAuthority: updateAuthority.publicKey,
                mintAuthority: mintAuthority.publicKey,
                mint: mint.publicKey,
                owner: owner.publicKey,
                ownerTokenAccount: ownerAta,
                metadata,
                masterEdition,
                systemProgram: SystemProgram.programId,
                associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                tokenProgram: TOKEN_PROGRAM_ID,
                tokenMetadataProgram: TOKEN_METADATA_ID,
                sysvarInstructions: SYSVAR_INSTRUCTIONS_PUBKEY, // <-- add this
            })
            .signers([updateAuthority, mintAuthority, mint])
            .rpc();

        console.log("mint:", mint.publicKey.toBase58());
        console.log("owner:", owner.publicKey.toBase58());
        console.log("ownerAta:", ownerAta.toBase58());
        console.log("tx:", txSig);

        const latest = await connection.getLatestBlockhash();
        await connection.confirmTransaction({ signature: txSig, ...latest }, "confirmed");

        const ataAcc = await getAccount(connection, ownerAta, "confirmed", TOKEN_PROGRAM_ID);
        expect(ataAcc.amount).to.equal(1n);

        // Basic assertions



        // 2) Metadata and Master Edition PDAs should exist
        const mdAcc = await connection.getAccountInfo(metadata, "confirmed");
        const meAcc = await connection.getAccountInfo(masterEdition, "confirmed");
        expect(mdAcc).to.not.be.null;
        expect(meAcc).to.not.be.null;

        // 3) Optional: log the tx for debugging
        console.log("Minted event NFT tx:", txSig);
    }
    );
    it("mints a TICKET NFT into a VERIFIED SIZED COLLECTION", async () => {
        const collectionMint = Keypair.generate();
        const collectionOwner = Keypair.generate();
        const collectionAta = getAssociatedTokenAddressSync(
            collectionMint.publicKey,
            collectionOwner.publicKey,
            false,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
        );

        const collectionMetadata = findMetadataPda(collectionMint.publicKey);
        const collectionEdition  = findMasterEditionPda(collectionMint.publicKey);

        await connection.confirmTransaction(
            await connection.requestAirdrop(collectionOwner.publicKey, (LAMPORTS_PER_SOL)),
            "confirmed"
        );

        const collTx = await program.methods
            .mintNftEvent(
                "My Collection",
                "COLL",
                "https://example.com/collection.json",
                500,
                true
            )
            .accounts({
                payer: provider.wallet.publicKey,
                updateAuthority: updateAuthority.publicKey,
                mintAuthority: mintAuthority.publicKey,
                mint: collectionMint.publicKey,
                owner: collectionOwner.publicKey,
                ownerTokenAccount: collectionAta,
                metadata: collectionMetadata,
                masterEdition: collectionEdition,
                systemProgram: SystemProgram.programId,
                associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                tokenProgram: TOKEN_PROGRAM_ID,
                tokenMetadataProgram: TOKEN_METADATA_ID,
                sysvarInstructions: SYSVAR_INSTRUCTIONS_PUBKEY,
            })
            .signers([updateAuthority, mintAuthority, collectionMint])
            .rpc();


        {
            const latest = await connection.getLatestBlockhash();
            await connection.confirmTransaction({ signature: collTx, ...latest }, "confirmed");

            const ataAcc = await getAccount(connection, collectionAta, "confirmed", TOKEN_PROGRAM_ID);
            expect(Number(ataAcc.amount)).to.equal(1);

            const md = await connection.getAccountInfo(collectionMetadata, { commitment: "confirmed" });
            const me = await connection.getAccountInfo(collectionEdition, { commitment: "confirmed" });
            expect(md).to.not.be.null;
            expect(me).to.not.be.null;

            console.log("Collection minted:", collTx);
        }

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
        const ticketEdition  = findMasterEditionPda(ticketMint.publicKey);

        await connection.confirmTransaction(
            await connection.requestAirdrop(ticketOwner.publicKey, (LAMPORTS_PER_SOL)),
            "confirmed"
        );
        const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({ units: 800_000 });
        const addPriorityFee = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 });
        const ticketTx = await program.methods
            .mintNftTicket(
                "My Ticket #1",
                "TKT",
                "https://example.com/ticket-1.json",
                500,
                true
            )
            .accounts({

                payer: provider.wallet.publicKey,
                updateAuthority: updateAuthority.publicKey,
                mintAuthority: mintAuthority.publicKey,
                mint: ticketMint.publicKey,
                owner: ticketOwner.publicKey,
                ownerTokenAccount: ticketAta,
                metadata: ticketMetadata,
                masterEdition: ticketEdition,


                collectionMint: collectionMint.publicKey,
                collectionMetadata: collectionMetadata,
                collectionMasterEdition: collectionEdition,
                collectionAuthority: updateAuthority.publicKey,

                systemProgram: SystemProgram.programId,
                associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                tokenProgram: TOKEN_PROGRAM_ID,
                tokenMetadataProgram: TOKEN_METADATA_ID,
                sysvarInstructions: SYSVAR_INSTRUCTIONS_PUBKEY,
            })
            .preInstructions([addPriorityFee, modifyComputeUnits])
            .signers([updateAuthority, mintAuthority, ticketMint])
            .rpc();

        {
            const latest = await connection.getLatestBlockhash();
            await connection.confirmTransaction({ signature: ticketTx, ...latest }, "confirmed");

            const ataAcc = await getAccount(connection, ticketAta, "confirmed", TOKEN_PROGRAM_ID);
            expect(Number(ataAcc.amount)).to.equal(1);

            const md = await connection.getAccountInfo(ticketMetadata, { commitment: "confirmed" });
            const me = await connection.getAccountInfo(ticketEdition, { commitment: "confirmed" });
            expect(md).to.not.be.null;
            expect(me).to.not.be.null;

            console.log("Ticket minted into collection:", ticketTx);
        }
    });

});

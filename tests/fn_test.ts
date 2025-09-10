import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { PublicKey, SystemProgram, Keypair } from '@solana/web3.js';
import { ComputeBudgetProgram } from "@solana/web3.js";
import {
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    getAssociatedTokenAddress,
    getAccount,
    getMint,
} from '@solana/spl-token';
import { assert } from 'chai';
import BN from 'bn.js';

describe.only("Gathered functions test", () => {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const program = anchor.workspace.NftTickets as Program;
    const programId = program.programId;
    const wallet = provider.wallet.publicKey;

    const TMID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
    const SYSVAR_IX = new PublicKey("Sysvar1nstructions1111111111111111111111111");
    const cuLimitIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 });
    const cuPriceIx = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 });

    const mintAuthPda = (mint: PublicKey) =>
        PublicKey.findProgramAddressSync([Buffer.from("mint_authority"), mint.toBuffer()], programId)[0];

    const mdPda = (mint: PublicKey) =>
        PublicKey.findProgramAddressSync([Buffer.from("metadata"), TMID.toBuffer(), mint.toBuffer()], TMID)[0];

    const mePda = (mint: PublicKey) =>
        PublicKey.findProgramAddressSync(
            [Buffer.from("metadata"), TMID.toBuffer(), mint.toBuffer(), Buffer.from("edition")],
            TMID
        )[0];

    const treasuryPda = (mint: PublicKey) =>
        PublicKey.findProgramAddressSync([Buffer.from("treasury"), mint.toBuffer()], programId)[0];

    const waitConfirmed = async (sig: string, timeoutMs = 10000) => {
        const t0 = Date.now();
        while (Date.now() - t0 < timeoutMs) {
            const st = await provider.connection.getSignatureStatuses([sig]);
            const v = st.value[0];
            if (v) {
                if (v.err) throw new Error(`tx failed: ${JSON.stringify(v.err)}`);
                if (v.confirmationStatus === "confirmed" || v.confirmationStatus === "finalized") return;
            }
            await new Promise((r) => setTimeout(r, 100));
        }
        throw new Error("tx not confirmed in time");
    };

    const collectionKp = Keypair.generate();
    const collectionMint = collectionKp.publicKey;

    it("create_event", async () => {
        const auth = mintAuthPda(collectionMint);
        const metadata = mdPda(collectionMint);
        const masterEdition = mePda(collectionMint);
        const treasury = treasuryPda(collectionMint);
        const ata = await getAssociatedTokenAddress(
            collectionMint,
            wallet,
            false,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
        );

        const sig = await program.methods
            .createEvent(
                "Collection",
                "CLT",
                "https://example.com/collection.json",
                0,
                new BN(1000),
                new BN(Math.floor(Date.now() / 1000) + 24 * 60 * 60)
            )
            .accounts({
                initMint: {
                    mint: collectionMint,
                    mintAuthority: auth,
                    payer: wallet,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    systemProgram: SystemProgram.programId,
                },
                mintOne: {
                    mint: collectionMint,
                    mintAuthority: auth,
                    payer: wallet,
                    associatedTokenAccount: ata,
                    systemProgram: SystemProgram.programId,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                },
                collectionInit: {
                    treasury,
                    payer: wallet,
                    mint: collectionMint,
                    metadata,
                    masterEdition,
                    tokenMetadataProgram: TMID,
                    mintAuthority: auth,
                    systemProgram: SystemProgram.programId,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    sysvarInstructions: SYSVAR_IX,
                },
            })
            .signers([collectionKp])
            .rpc();

        await waitConfirmed(sig);

        const mintInfo = await getMint(provider.connection, collectionMint);
        assert.equal(mintInfo.decimals, 0);
        const ataAcc = await getAccount(provider.connection, ata);
        assert.equal(Number(ataAcc.amount), 1);

        const mdAcc = await provider.connection.getAccountInfo(metadata);
        const meAcc = await provider.connection.getAccountInfo(masterEdition);
        assert.ok(mdAcc && meAcc);
        assert.equal(mdAcc!.owner.toBase58(), TMID.toBase58());
        assert.equal(meAcc!.owner.toBase58(), TMID.toBase58());

        const tr = await provider.connection.getAccountInfo(treasury);
        assert.ok(tr);
        console.log("collection initialized");
    });

    it("buy ticket", async () => {
        const ticketKp = Keypair.generate();
        const ticketMint = ticketKp.publicKey;
        const coll_auth = mintAuthPda(collectionMint);
        const auth = mintAuthPda(ticketMint);
        const coll_metadata = mdPda(collectionMint);
        const coll_masterEdition = mePda(collectionMint);
        const metadata = mdPda(ticketMint);
        const masterEdition = mePda(ticketMint);
        const treasury = treasuryPda(collectionMint);
        const ata = await getAssociatedTokenAddress(
            ticketMint,
            wallet,
            false,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
        );



        const sig = await program.methods
            .buyTicket("Ticket", "22", "https://example.com/collection.json", 0)
            .accounts({
                ticketPayment: {
                    treasury,
                    collectionMint: collectionMint,
                    payer: wallet,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    systemProgram: SystemProgram.programId,
                },
                initMint: {
                    mint: ticketMint,
                    mintAuthority: auth,
                    payer: wallet,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    systemProgram: SystemProgram.programId,
                },
                mintOne: {
                    mint: ticketMint,
                    mintAuthority: auth,
                    payer: wallet,
                    associatedTokenAccount: ata,
                    systemProgram: SystemProgram.programId,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                },
                ticketInit: {
                    payer: wallet,
                    mint: ticketMint,
                    collection: collectionMint,
                    collectionMintAuthority: coll_auth,
                    metadata,
                    masterEdition,
                    tokenMetadataProgram: TMID,
                    mintAuthority: auth,
                    systemProgram: SystemProgram.programId,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    sysvarInstructions: SYSVAR_IX,
                },
                verifyCollection: {
                    mint: ticketMint,
                    collectionMint: collectionMint,
                    payer: wallet,
                    collectionMintAuthority: coll_auth,
                    itemMintAuthority: auth,
                    collectionMetadata: coll_metadata,
                    collectionMasterEdition: coll_masterEdition,
                    itemMetadata: metadata,
                    tokenMetadataProgram: TMID,
                },
            })
            .preInstructions([cuLimitIx, cuPriceIx])
            .signers([ticketKp])
            .rpc();

        await waitConfirmed(sig);
        console.log("ticket mint done, collection verified");

        const sig5 = await program.methods
            .utilize()
            .accounts({
                metadata: metadata,
                associatedTokenAccount: ata,
                mint: ticketMint,
                owner: wallet,
                tokenProgram: TOKEN_PROGRAM_ID,
                associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
                tokenMetadataProgram: TMID,
            })
            .rpc()
        await waitConfirmed(sig5)

        console.log("use ticket done");



        const mintInfo = await getMint(provider.connection, collectionMint);
        assert.equal(mintInfo.decimals, 0);

        const ataAcc = await getAccount(provider.connection, ata);
        assert.equal(Number(ataAcc.amount), 1);

        const mdAcc = await provider.connection.getAccountInfo(metadata);
        const meAcc = await provider.connection.getAccountInfo(masterEdition);
        assert.ok(mdAcc && meAcc);
        assert.equal(mdAcc!.owner.toBase58(), TMID.toBase58());
        assert.equal(meAcc!.owner.toBase58(), TMID.toBase58());

        const tr = await provider.connection.getAccountInfo(treasury);
        assert.ok(tr);


    });
    it("return funds", async () => {
        const ticketKp = Keypair.generate();
        const ticketMint = ticketKp.publicKey;
        const coll_auth = mintAuthPda(collectionMint);
        const auth = mintAuthPda(ticketMint);
        const coll_metadata = mdPda(collectionMint);
        const coll_masterEdition = mePda(collectionMint);
        const metadata = mdPda(ticketMint);
        const masterEdition = mePda(ticketMint);
        const treasury = treasuryPda(collectionMint);
        const ata = await getAssociatedTokenAddress(
            ticketMint,
            wallet,
            false,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
        );



        const sig_ticket = await program.methods
            .buyTicket("Ticket", "22", "https://example.com/collection.json", 0)
            .accounts({
                ticketPayment: {
                    treasury,
                    collectionMint: collectionMint,
                    payer: wallet,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    systemProgram: SystemProgram.programId,
                },
                initMint: {
                    mint: ticketMint,
                    mintAuthority: auth,
                    payer: wallet,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    systemProgram: SystemProgram.programId,
                },
                mintOne: {
                    mint: ticketMint,
                    mintAuthority: auth,
                    payer: wallet,
                    associatedTokenAccount: ata,
                    systemProgram: SystemProgram.programId,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                },
                ticketInit: {
                    payer: wallet,
                    mint: ticketMint,
                    collection: collectionMint,
                    collectionMintAuthority: coll_auth,
                    metadata,
                    masterEdition,
                    tokenMetadataProgram: TMID,
                    mintAuthority: auth,
                    systemProgram: SystemProgram.programId,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    sysvarInstructions: SYSVAR_IX,
                },
                verifyCollection: {
                    mint: ticketMint,
                    collectionMint: collectionMint,
                    payer: wallet,
                    collectionMintAuthority: coll_auth,
                    itemMintAuthority: auth,
                    collectionMetadata: coll_metadata,
                    collectionMasterEdition: coll_masterEdition,
                    itemMetadata: metadata,
                    tokenMetadataProgram: TMID,
                },
            })
            .preInstructions([cuLimitIx, cuPriceIx])
            .signers([ticketKp])
            .rpc();

        await waitConfirmed(sig_ticket);
        console.log("ticket mint done, collection verified");


        const sig = await program.methods
            .returnFunds()
            .accounts({
                treasury,
                collectionMint: collectionMint,
                ticketMint: ticketMint,
                ticketMetadata: metadata,
                assetOwner: wallet,
                tokenProgram: TOKEN_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
                burnTicket: {
                    collection: coll_metadata,
                    metadata: metadata,
                    masterEdition: masterEdition,
                    mint: ticketMint,
                    associatedTokenAccount: ata,
                    owner: wallet,
                    tokenMetadataProgram: TMID,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    systemProgram: SystemProgram.programId,
                    sysvarInstructions: SYSVAR_IX,
                },
            })
            .preInstructions([cuLimitIx, cuPriceIx])
            .rpc();

        await waitConfirmed(sig);
        console.log("fund return done");
        console.log("ticket burned");

    });
    it("withdrawal", async () => {
        console.log("collection init");
        const collectionKp = Keypair.generate();
        const collectionMint = collectionKp.publicKey;
        const auth_col = mintAuthPda(collectionMint);
        const metadata = mdPda(collectionMint);
        const masterEdition = mePda(collectionMint);
        const treasury = treasuryPda(collectionMint);
        const ata_col = await getAssociatedTokenAddress(
            collectionMint,
            wallet,
            false,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
        );

        const sig1 = await program.methods
            .createEvent(
                "Collection",
                "CLT",
                "https://example.com/collection.json",
                0,
                new BN(1000),
                new BN(Math.floor(Date.now() / 1000) - 24 * 60 * 60)
            )
            .accounts({
                initMint: {
                    mint: collectionMint,
                    mintAuthority: auth_col,
                    payer: wallet,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    systemProgram: SystemProgram.programId,
                },
                mintOne: {
                    mint: collectionMint,
                    mintAuthority: auth_col,
                    payer: wallet,
                    associatedTokenAccount: ata_col,
                    systemProgram: SystemProgram.programId,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                },
                collectionInit: {
                    treasury,
                    payer: wallet,
                    mint: collectionMint,
                    metadata,
                    masterEdition,
                    tokenMetadataProgram: TMID,
                    mintAuthority: auth_col,
                    systemProgram: SystemProgram.programId,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    sysvarInstructions: SYSVAR_IX,
                },
            })
            .signers([collectionKp])
            .rpc();

        await waitConfirmed(sig1);

        const ticketKp = Keypair.generate();
        const ticketMint = ticketKp.publicKey;
        const coll_auth = mintAuthPda(collectionMint);
        const coll_metadata = mdPda(collectionMint);
        const coll_masterEdition = mePda(collectionMint);
        const auth = mintAuthPda(ticketMint);
        const ata = await getAssociatedTokenAddress(
            ticketMint,
            wallet,
            false,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
        );


        console.log("buy ticket");
        const sig2 = await program.methods
            .buyTicket("Ticket", "22", "https://example.com/collection.json", 0)
            .accounts({
                ticketPayment: {
                    treasury,
                    collectionMint: collectionMint,
                    payer: wallet,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    systemProgram: SystemProgram.programId,
                },
                initMint: {
                    mint: ticketMint,
                    mintAuthority: auth,
                    payer: wallet,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    systemProgram: SystemProgram.programId,
                },
                mintOne: {
                    mint: ticketMint,
                    mintAuthority: auth,
                    payer: wallet,
                    associatedTokenAccount: ata,
                    systemProgram: SystemProgram.programId,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                },
                ticketInit: {
                    payer: wallet,
                    mint: ticketMint,
                    collection: collectionMint,
                    collectionMintAuthority: coll_auth,
                    metadata,
                    masterEdition,
                    tokenMetadataProgram: TMID,
                    mintAuthority: auth,
                    systemProgram: SystemProgram.programId,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    sysvarInstructions: SYSVAR_IX,
                },
                verifyCollection: {
                    mint: ticketMint,
                    collectionMint: collectionMint,
                    payer: wallet,
                    collectionMintAuthority: coll_auth,
                    itemMintAuthority: auth,
                    collectionMetadata: coll_metadata,
                    collectionMasterEdition: coll_masterEdition,
                    itemMetadata: metadata,
                    tokenMetadataProgram: TMID,
                },
            })
            .preInstructions([cuLimitIx, cuPriceIx])
            .signers([ticketKp])
            .rpc();

        await waitConfirmed(sig2);
        console.log("ticket mint done, collection verified");
        const sig6 = await program.methods
            .withdraw(new BN(1))
            .accounts({
                treasury,
                collectionMint: collectionMint,
                eventOwner: wallet,
                tokenProgram: TOKEN_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
            })
            .rpc()

        await waitConfirmed(sig6)
        console.log("withdrawal done");


        const mintInfo = await getMint(provider.connection, collectionMint);
        assert.equal(mintInfo.decimals, 0);

        const ataAcc = await getAccount(provider.connection, ata);
        assert.equal(Number(ataAcc.amount), 1);

        const mdAcc = await provider.connection.getAccountInfo(metadata);
        const meAcc = await provider.connection.getAccountInfo(masterEdition);
        assert.ok(mdAcc && meAcc);
        assert.equal(mdAcc!.owner.toBase58(), TMID.toBase58());
        assert.equal(meAcc!.owner.toBase58(), TMID.toBase58());

        const tr = await provider.connection.getAccountInfo(treasury);
        assert.ok(tr);


    });

});

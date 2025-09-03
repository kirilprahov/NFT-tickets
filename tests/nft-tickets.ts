import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { PublicKey, SystemProgram, Keypair } from '@solana/web3.js';
import {
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    getAssociatedTokenAddress,
    getAccount,
    getMint,
} from '@solana/spl-token';
import { assert } from 'chai';
import BN from 'bn.js';

describe('nft-tickets', () => {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const program = anchor.workspace.NftTickets as Program;
    const programId = program.programId;
    const wallet = provider.wallet.publicKey;

    const TMID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');
    const SYSVAR_IX = new PublicKey('Sysvar1nstructions1111111111111111111111111');

    const mintAuthPda = (mint: PublicKey) =>
        PublicKey.findProgramAddressSync([Buffer.from('mint_authority'), mint.toBuffer()], programId)[0];

    const mdPda = (mint: PublicKey) =>
        PublicKey.findProgramAddressSync(
            [Buffer.from('metadata'), TMID.toBuffer(), mint.toBuffer()],
            TMID
        )[0];

    const mePda = (mint: PublicKey) =>
        PublicKey.findProgramAddressSync(
            [Buffer.from('metadata'), TMID.toBuffer(), mint.toBuffer(), Buffer.from('edition')],
            TMID
        )[0];

    const treasuryPda = (collectionMint: PublicKey) =>
        PublicKey.findProgramAddressSync([Buffer.from('treasury'), collectionMint.toBuffer()], programId)[0];

    const waitConfirmed = async (sig: string, timeoutMs = 10000) => {
        const t0 = Date.now();
        while (Date.now() - t0 < timeoutMs) {
            const st = await provider.connection.getSignatureStatuses([sig]);
            const v = st.value[0];
            if (v) {
                if (v.err) throw new Error(`tx failed: ${JSON.stringify(v.err)}`);
                if (v.confirmationStatus === 'confirmed' || v.confirmationStatus === 'finalized') return;
            }
            await new Promise(r => setTimeout(r, 100));
        }
        throw new Error('tx not confirmed in time');
    };

    const collectionKp = Keypair.generate();
    const collectionMint = collectionKp.publicKey;

    it('init_mint', async () => {
        const auth = mintAuthPda(collectionMint);
        const sig = await program.methods
            .initMint()
            .accounts({
                mint: collectionMint,
                mintAuthority: auth,
                payer: wallet,
                tokenProgram: TOKEN_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
            })
            .signers([collectionKp])
            .rpc();
        await waitConfirmed(sig);

        const info = await getMint(provider.connection, collectionMint);
        assert.equal(info.decimals, 0);
        assert.equal(info.mintAuthority?.toBase58(), auth.toBase58());
        assert.equal(Number(info.supply), 0);
    });

    it('mint_nft', async () => {
        const auth = mintAuthPda(collectionMint);
        const ata = await getAssociatedTokenAddress(
            collectionMint,
            wallet,
            false,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
        );
        const sig = await program.methods
            .mintNft()
            .accounts({
                mint: collectionMint,
                mintAuthority: auth,
                payer: wallet,
                associatedTokenAccount: ata,
                systemProgram: SystemProgram.programId,
                tokenProgram: TOKEN_PROGRAM_ID,
                associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            })
            .rpc();
        await waitConfirmed(sig);

        const acc = await getAccount(provider.connection, ata);
        assert.equal(Number(acc.amount), 1);
    });

    it('collection_init', async () => {
        const auth = mintAuthPda(collectionMint);
        const metadata = mdPda(collectionMint);
        const masterEdition = mePda(collectionMint);
        const treasury = treasuryPda(collectionMint);

        const sig = await program.methods
            .collectionInit('Collection', 'CLT', 'https://example.com/collection.json', 550, new BN(1000), new BN(Date.now()))
            .accounts({
                payer: wallet,
                mint: collectionMint,
                metadata,
                masterEdition,
                tokenMetadataProgram: TMID,
                mintAuthority: auth,
                systemProgram: SystemProgram.programId,
                tokenProgram: TOKEN_PROGRAM_ID,
                sysvarInstructions: SYSVAR_IX,
                treasury,
            })
            .rpc();
        await waitConfirmed(sig);

        const mdAcc = await provider.connection.getAccountInfo(metadata);
        const meAcc = await provider.connection.getAccountInfo(masterEdition);
        assert.ok(mdAcc && meAcc);
        assert.equal(mdAcc!.owner.toBase58(), TMID.toBase58());
        assert.equal(meAcc!.owner.toBase58(), TMID.toBase58());
        const tr = await provider.connection.getAccountInfo(treasury);
        assert.ok(tr);
    });

    it('ticket_init + verify_collection + payment + burn', async () => {
        const ticketKp = Keypair.generate();
        const ticketMint = ticketKp.publicKey;

        const ticketAuth = mintAuthPda(ticketMint);
        const collAuth = mintAuthPda(collectionMint);

        const sig0 = await program.methods
            .initMint()
            .accounts({
                mint: ticketMint,
                mintAuthority: ticketAuth,
                payer: wallet,
                tokenProgram: TOKEN_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
            })
            .signers([ticketKp])
            .rpc();
        await waitConfirmed(sig0);

        const ticketInfo = await getMint(provider.connection, ticketMint);
        assert.equal(ticketInfo.mintAuthority?.toBase58(), ticketAuth.toBase58());

        const ataTicket = await getAssociatedTokenAddress(ticketMint, wallet, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
        const sig1 = await program.methods
            .mintNft()
            .accounts({
                mint: ticketMint,
                mintAuthority: ticketAuth,
                payer: wallet,
                associatedTokenAccount: ataTicket,
                systemProgram: SystemProgram.programId,
                tokenProgram: TOKEN_PROGRAM_ID,
                associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            })
            .rpc();
        await waitConfirmed(sig1);

        const ticketAcc = await getAccount(provider.connection, ataTicket);
        assert.equal(Number(ticketAcc.amount), 1);

        const tMd = mdPda(ticketMint);
        const tMe = mePda(ticketMint);
        const sig2 = await program.methods
            .ticketInit('Ticket #1', 'TIX', 'https://example.com/ticket.json', 550)
            .accounts({
                payer: wallet,
                mint: ticketMint,
                collection: collectionMint,
                metadata: tMd,
                masterEdition: tMe,
                tokenMetadataProgram: TMID,
                mintAuthority: ticketAuth,
                systemProgram: SystemProgram.programId,
                tokenProgram: TOKEN_PROGRAM_ID,
                sysvarInstructions: SYSVAR_IX,
            })
            .rpc();
        await waitConfirmed(sig2);

        const sig3 = await program.methods
            .verifyCollection()
            .accounts({
                mint: ticketMint,
                collectionMint: collectionMint,
                payer: wallet,
                collectionMintAuthority: collAuth,
                itemMintAuthority: ticketAuth,
                collectionMetadata: mdPda(collectionMint),
                collectionMasterEdition: mePda(collectionMint),
                metadata: tMd,
                tokenMetadataProgram: TMID,
            })
            .rpc();
        await waitConfirmed(sig3);

        const treasury = treasuryPda(collectionMint);
        const balBefore = await provider.connection.getBalance(treasury);
        const sig4 = await program.methods
            .ticketPayment()
            .accounts({
                mint: ticketMint,
                collectionMint: collectionMint,
                treasury,
                payer: wallet,
                tokenProgram: TOKEN_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
            })
            .rpc();
        await waitConfirmed(sig4);
        const balAfter = await provider.connection.getBalance(treasury);
        assert.isAbove(balAfter, balBefore);

        const sig5 = await program.methods
            .burn()
            .accounts({
                mintAuthority: ticketAuth,
                collection: collectionMint,
                metadata: tMd,
                masterEdition: tMe,
                mint: ticketMint,
                associatedTokenAccount: ataTicket,
                tokenMetadataProgram: TMID,
                tokenProgram: TOKEN_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
                sysvarInstructions: SYSVAR_IX,
            })
            .rpc();
        await waitConfirmed(sig5);

        const tAfter = await getMint(provider.connection, ticketMint);
        assert.equal(Number(tAfter.supply), 0);
    });
});

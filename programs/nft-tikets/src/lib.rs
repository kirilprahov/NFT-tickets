use anchor_lang::prelude::*;
use anchor_lang::solana_program::{self, program::invoke_signed};
use anchor_lang::system_program::{self, Transfer}; // <-- Anchor's re-export

use anchor_spl::{
    associated_token::AssociatedToken,
    metadata::{set_and_verify_sized_collection_item, SetAndVerifySizedCollectionItem},
    token::{self as spl_token, Mint, MintTo, Token, TokenAccount},
};

use mpl::{
    accounts::Metadata as MplMetadata,
    instructions::{CreateCpiBuilder, UtilizeBuilder},
    types::{Collection, CollectionDetails, CreateArgs, Creator, PrintSupply, TokenStandard},
    ID as TOKEN_METADATA_ID,
};
use mpl_token_metadata as mpl;

declare_id!("8Z8bsgf7SYGAh1Sy96oz4dfcZtTiPL1pkSLrn6RELkLr");

#[program]
pub mod nft_tikets {
    use super::*;

    pub fn mint_nft_event(
        ctx: Context<Event>,
        name: String,
        symbol: String,
        uri: String,
        seller_fee_bps: u16,
        is_mutable: bool,
        price: u64,
        event_ts: u64,
    ) -> Result<()> {
        msg!("mint_nft_event");
        let bump = ctx.bumps.treasury;
        ctx.accounts.treasury.set_inner(Treasury {
            authority: ctx.accounts.treasury.key(),
            collection_mint: ctx.accounts.mint.key(),
            event_ts,
            bump,
            price,
        });
        helpers::mint_one_event(&ctx.accounts)?;
        helpers::create_metadata_event(
            &ctx.accounts,
            name,
            symbol,
            uri,
            seller_fee_bps,
            is_mutable,
        )?;
        //helpers::create_master_edition_event(&ctx.accounts)?;
        Ok(())
    }
    pub fn mint_nft_ticket(
        ctx: Context<Ticket>,
        name: String,
        symbol: String,
        uri: String,
        seller_fee_bps: u16,
        is_mutable: bool,
    ) -> Result<()> {
        msg!("mint_nft_ticket");
        helpers::buy_ticket(&ctx.accounts)?;
        helpers::mint_one(&ctx.accounts)?;
        helpers::create_metadata_ticket(
            &ctx.accounts,
            name,
            symbol,
            uri,
            seller_fee_bps,
            is_mutable,
        )?;
        let bump = [ctx.accounts.treasury.bump];
        let signer_seeds: [&[u8]; 3] = [
            b"treasury",
            ctx.accounts.treasury.collection_mint.as_ref(),
            &bump,
        ];
        let signer_seeds_arr: [&[&[u8]]; 1] = [&signer_seeds];
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_metadata_program.to_account_info(),
            SetAndVerifySizedCollectionItem {
                metadata: ctx.accounts.metadata.to_account_info(),
                collection_authority: ctx.accounts.collection_authority.to_account_info(),
                payer: ctx.accounts.payer.to_account_info(),
                update_authority: ctx.accounts.treasury.to_account_info(),
                collection_mint: ctx.accounts.collection_mint.to_account_info(),
                collection_metadata: ctx.accounts.collection_metadata.to_account_info(),
                collection_master_edition: ctx.accounts.collection_master_edition.to_account_info(),
            },
            &signer_seeds_arr,
        );
        set_and_verify_sized_collection_item(cpi_ctx, None)?;
        //helpers::create_master_edition(&ctx.accounts)?;
        Ok(())
    }

    pub fn ticket_usage(ctx: Context<TokenUse>) -> Result<()> {
        {
            let data_ref = ctx.accounts.metadata.try_borrow_data()?;
            let mut slice: &[u8] = &data_ref;
            let md = MplMetadata::safe_deserialize(&mut slice)
                .map_err(|_| error!(NftError::InvalidMetadata))?;
            require_keys_eq!(
                md.mint,
                ctx.accounts.mint.key(),
                NftError::MetadataMintMismatch
            );
            let uses = md.uses.as_ref().ok_or(error!(NftError::NoUsesConfigured))?;
            require!(uses.remaining >= 1, NftError::NoRemainingUses);
            msg!("uses before {}", uses.remaining);
        }

        let mut builder = UtilizeBuilder::new();
        builder
            .metadata(ctx.accounts.metadata.key())
            .token_account(ctx.accounts.token_account.key())
            .mint(ctx.accounts.mint.key())
            .use_authority(ctx.accounts.owner.key())
            .owner(ctx.accounts.owner.key())
            .number_of_uses(1)
            .token_program(ctx.accounts.token_program.key())
            .ata_program(ctx.accounts.associated_token_program.key())
            .system_program(ctx.accounts.system_program.key())
            .rent(ctx.accounts.rent.key());

        let ix = builder.instruction();

        invoke_signed(
            &ix,
            &[
                ctx.accounts.metadata.to_account_info(),
                ctx.accounts.token_account.to_account_info(),
                ctx.accounts.mint.to_account_info(),
                ctx.accounts.owner.to_account_info(),
                ctx.accounts.owner.to_account_info(),
                ctx.accounts.token_program.to_account_info(),
                ctx.accounts.associated_token_program.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
                ctx.accounts.rent.to_account_info(),
                ctx.accounts.token_metadata_program.to_account_info(),
            ],
            &[],
        )?;
        {
            let data_ref = ctx.accounts.metadata.try_borrow_data()?;
            let mut slice: &[u8] = &data_ref;
            let md = MplMetadata::safe_deserialize(&mut slice)
                .map_err(|_| error!(NftError::InvalidMetadata))?;
            let uses = md.uses.as_ref().ok_or(error!(NftError::NoUsesConfigured))?;
            require!(uses.remaining >= 0, NftError::Failed);
            msg!("uses after {}", uses.remaining);
        }

        Ok(())
    }
}

mod helpers {
    use anchor_spl::metadata::mpl_token_metadata::types::{UseMethod, Uses};

    use super::*;

    pub fn mint_one(ctx: &Ticket) -> Result<()> {
        let seeds: &[&[u8]] = &[
            b"treasury",
            ctx.treasury.collection_mint.as_ref(),
            &[ctx.treasury.bump],
        ];
        spl_token::mint_to(
            CpiContext::new_with_signer(
                ctx.token_program.to_account_info(),
                MintTo {
                    mint: ctx.mint.to_account_info(),
                    to: ctx.associated_token_account.to_account_info(),
                    authority: ctx.treasury.to_account_info(),
                },
                &[seeds],
            ),
            1,
        )
    }
    pub fn mint_one_event(ctx: &Event) -> Result<()> {
        let binding = ctx.mint.key();
        let seeds: &[&[u8]] = &[b"treasury", binding.as_ref(), &[ctx.treasury.bump]];
        spl_token::mint_to(
            CpiContext::new_with_signer(
                ctx.token_program.to_account_info(),
                MintTo {
                    mint: ctx.mint.to_account_info(),
                    to: ctx.associated_token_account.to_account_info(),
                    authority: ctx.treasury.to_account_info(),
                },
                &[seeds],
            ),
            1,
        )
    }

    pub fn create_metadata_event(
        ctx: &Event,
        name: String,
        symbol: String,
        uri: String,
        seller_fee_basis_points: u16,
        is_mutable: bool,
    ) -> Result<()> {
        super::pda_checks(&ctx.metadata, &ctx.master_edition, &ctx.mint)?;
        let creators = vec![Creator {
            address: ctx.treasury.key(),
            verified: false,
            share: 100,
        }];
        let args = CreateArgs::V1 {
            name,
            symbol,
            uri,
            seller_fee_basis_points,
            creators: Some(creators),
            primary_sale_happened: false,
            is_mutable,
            token_standard: TokenStandard::NonFungible,
            collection: None,
            uses: None,
            collection_details: Some(CollectionDetails::V1 { size: 0 }),
            rule_set: None,
            decimals: Some(0),
            print_supply: Some(PrintSupply::Zero),
        };
        let binding = ctx.mint.key();
        let seeds: &[&[u8]] = &[b"treasury", binding.as_ref(), &[ctx.treasury.bump]];

        Ok(CreateCpiBuilder::new(&ctx.token_metadata_program)
            .metadata(&ctx.metadata)
            .master_edition(Some(&ctx.master_edition))
            .mint(&ctx.mint.to_account_info(), true)
            .authority(&ctx.treasury.to_account_info())
            .payer(&ctx.payer)
            .update_authority(&ctx.treasury.to_account_info(), true)
            .system_program(&ctx.system_program)
            .spl_token_program(Some(&ctx.token_program))
            .sysvar_instructions(&ctx.sysvar_instructions)
            .create_args(args)
            .invoke_signed(&[seeds])?)
    }
    pub fn create_metadata_ticket(
        ctx: &Ticket,
        name: String,
        symbol: String,
        uri: String,
        seller_fee_basis_points: u16,
        is_mutable: bool,
    ) -> Result<()> {
        super::pda_checks(&ctx.metadata, &ctx.master_edition, &ctx.mint)?;
        let creators = vec![Creator {
            address: ctx.treasury.key(),
            verified: false,
            share: 100,
        }];
        let args = CreateArgs::V1 {
            name,
            symbol,
            uri,
            seller_fee_basis_points,
            creators: Some(creators),
            primary_sale_happened: false,
            is_mutable,
            token_standard: TokenStandard::NonFungible,
            collection: Some(Collection {
                key: ctx.collection_mint.key(),
                verified: false,
            }),
            uses: Some(Uses {
                use_method: UseMethod::Single,
                remaining: 1,
                total: 1,
            }),
            collection_details: None,
            rule_set: None,
            decimals: Some(0),
            print_supply: Some(PrintSupply::Zero),
        };
        let seeds: &[&[u8]] = &[
            b"treasury",
            ctx.treasury.collection_mint.as_ref(),
            &[ctx.treasury.bump],
        ];
        Ok(CreateCpiBuilder::new(&ctx.token_metadata_program)
            .metadata(&ctx.metadata)
            .master_edition(Some(&ctx.master_edition))
            .mint(&ctx.mint.to_account_info(), true)
            .authority(&ctx.treasury.to_account_info())
            .payer(&ctx.payer)
            .update_authority(&ctx.treasury.to_account_info(), true)
            .system_program(&ctx.system_program)
            .spl_token_program(Some(&ctx.token_program))
            .sysvar_instructions(&ctx.sysvar_instructions)
            .create_args(args)
            .invoke_signed(&[seeds])?)
    }
    pub fn buy_ticket(ctx: &Ticket) -> Result<()> {
        let price = ctx.treasury.price;
        let cpi_program = ctx.system_program.to_account_info();
        let cpi_accounts = Transfer {
            from: ctx.payer.to_account_info(),
            to: ctx.treasury.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        system_program::transfer(cpi_ctx, price)
    }

    // pub fn create_master_edition(a: &Ticket) -> Result<()> {
    //     super::pda_checks(&a.metadata, &a.master_edition, &a.mint)?;
    //     Ok(CreateMasterEditionV3CpiBuilder::new(&a.token_metadata_program)
    //         .edition(&a.master_edition)
    //         .mint(&a.mint.to_account_info())
    //         .update_authority(&a.update_authority)
    //         .mint_authority(&a.mint_authority)
    //         .payer(&a.payer)
    //         .metadata(&a.metadata)
    //         .system_program(&a.system_program)
    //         .token_program(&a.token_program)
    //         .max_supply(0)
    //         .invoke()?)
    // }
    // pub fn create_master_edition_event(a: &Event) -> Result<()> {
    //     super::pda_checks(&a.metadata, &a.master_edition, &a.mint)?;
    //     Ok(CreateMasterEditionV3CpiBuilder::new(&a.token_metadata_program)
    //         .edition(&a.master_edition)
    //         .mint(&a.mint.to_account_info())
    //         .update_authority(&a.update_authority)
    //         .mint_authority(&a.mint_authority)
    //         .payer(&a.payer)
    //         .metadata(&a.metadata)
    //         .system_program(&a.system_program)
    //         .token_program(&a.token_program)
    //         .max_supply(0)
    //         .invoke()?)
    // }
}

fn pda_checks(
    metadata: &UncheckedAccount,
    master_edition: &UncheckedAccount,
    mint: &Account<Mint>,
) -> Result<()> {
    let (md, _) = Pubkey::find_program_address(
        &[
            b"metadata",
            &TOKEN_METADATA_ID.to_bytes(),
            &mint.key().to_bytes(),
        ],
        &TOKEN_METADATA_ID,
    );
    require_keys_eq!(md, metadata.key(), NftError::BadMetadataPda);

    let (ed, _) = Pubkey::find_program_address(
        &[
            b"metadata",
            &TOKEN_METADATA_ID.to_bytes(),
            &mint.key().to_bytes(),
            b"edition",
        ],
        &TOKEN_METADATA_ID,
    );
    require_keys_eq!(ed, master_edition.key(), NftError::BadEditionPda);
    Ok(())
}
#[account]
#[derive(InitSpace)]
pub struct Treasury {
    pub authority: Pubkey,
    pub collection_mint: Pubkey,
    pub event_ts: u64,
    pub bump: u8,
    pub price: u64,
}

#[derive(Accounts)]
pub struct Event<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        init,
        payer = payer,
        mint::decimals = 0,
        mint::authority = treasury,
        mint::freeze_authority = treasury,
        mint::token_program = token_program,
    )]
    pub mint: Account<'info, Mint>,

    #[account(init,
    payer = payer,
    seeds = [b"treasury", mint.key().as_ref()],
    bump,
    space = 8 + Treasury::INIT_SPACE,
    )]
    pub treasury: Account<'info, Treasury>,

    pub owner: SystemAccount<'info>,

    #[account(
        init,
        payer = payer,
        associated_token::mint = mint,
        associated_token::authority = owner,
        associated_token::token_program = token_program
    )]
    pub associated_token_account: Account<'info, TokenAccount>,

    /// CHECK:
    #[account(mut)]
    pub metadata: UncheckedAccount<'info>,
    /// CHECK:
    #[account(mut)]
    pub master_edition: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Program<'info, Token>, // <— classic SPL Token program
    /// CHECK:
    #[account(address = TOKEN_METADATA_ID)]
    pub token_metadata_program: UncheckedAccount<'info>,
    /// CHECK:
    #[account(address = solana_program::sysvar::instructions::ID)]
    pub sysvar_instructions: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct Ticket<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
    mut,
    seeds = [b"treasury", treasury.collection_mint.key().as_ref()],
    bump = treasury.bump,
    )]
    pub treasury: Account<'info, Treasury>,

    #[account(
        init,
        payer = payer,
        mint::decimals = 0,
        mint::authority = treasury,
        mint::freeze_authority = treasury,
        mint::token_program = token_program,
    )]
    pub mint: Account<'info, Mint>,

    pub owner: SystemAccount<'info>,

    #[account(
        init,
        payer = payer,
        associated_token::mint = mint,
        associated_token::authority = owner,
        associated_token::token_program = token_program
    )]
    pub associated_token_account: Account<'info, TokenAccount>,

    // collection data
    /// CHECK:
    pub collection_mint: UncheckedAccount<'info>,
    /// CHECK:
    #[account(mut)]
    pub collection_metadata: UncheckedAccount<'info>,
    /// CHECK:
    pub collection_master_edition: UncheckedAccount<'info>,
    /// CHECK:
    #[account(constraint = collection_authority.key() == treasury.key())]
    pub collection_authority: UncheckedAccount<'info>,

    // ticket metadata
    /// CHECK:
    #[account(mut)]
    pub metadata: UncheckedAccount<'info>,
    /// CHECK:
    #[account(mut)]
    pub master_edition: UncheckedAccount<'info>,

    // programs
    pub system_program: Program<'info, System>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Program<'info, Token>, // <—
    /// CHECK:
    #[account(address = TOKEN_METADATA_ID)]
    pub token_metadata_program: UncheckedAccount<'info>,
    /// CHECK:
    #[account(address = solana_program::sysvar::instructions::ID)]
    pub sysvar_instructions: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct TokenUse<'info> {
    /// CHECK:
    #[account(mut)]
    pub metadata: UncheckedAccount<'info>,
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut)]
    pub mint: Account<'info, Mint>,
    #[account(mut)]
    pub token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub rent: Sysvar<'info, Rent>,
    pub system_program: Program<'info, System>,
    /// CHECK: program id
    #[account(address = mpl_token_metadata::ID)]
    pub token_metadata_program: UncheckedAccount<'info>,
}

#[error_code]
pub enum NftError {
    #[msg("Bad metadata PDA")]
    BadMetadataPda,
    #[msg("Bad master edition PDA")]
    BadEditionPda,
    #[msg("Invalid metadata account data.")]
    InvalidMetadata,
    #[msg("Metadata mint doesn't match the provided mint.")]
    MetadataMintMismatch,
    #[msg("This NFT has no 'uses' configured.")]
    NoUsesConfigured,
    #[msg("This NFT has no remaining uses.")]
    NoRemainingUses,
    #[msg("Use Failed")]
    Failed
}
